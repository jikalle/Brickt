import { Interface, JsonRpcProvider } from 'ethers';
import type { Sequelize, Transaction } from 'sequelize';
import PropertyCrowdfundAbi from './abis/PropertyCrowdfund.json' assert { type: 'json' };
import ProfitDistributorAbi from './abis/ProfitDistributor.json' assert { type: 'json' };
import { markOnchainActivityIndexed } from '../lib/onchainActivity.js';

const REORG_DEPTH = 15;
const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_LOG_ADDRESS_CHUNK_SIZE = 8;

const CROWDFUND_STATES = ['ACTIVE', 'SUCCESS', 'FAILED', 'WITHDRAWN'] as const;

type CrowdfundState = (typeof CROWDFUND_STATES)[number];

type CampaignRow = {
  id: string;
  property_id: string;
  contract_address: string;
};

type ProfitDistributorRow = {
  id: string;
  property_id: string;
  contract_address: string;
};

type ParsedChainLog = {
  address: string;
  topics: string[];
  data: string;
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
};

export class Indexer {
  private provider: JsonRpcProvider;
  private db: Sequelize;
  private crowdfundInterface = new Interface(PropertyCrowdfundAbi);
  private profitInterface = new Interface(ProfitDistributorAbi);
  private crowdfundReadInterface = new Interface([
    'function propertyId() view returns (string)',
    'function targetAmountUSDC() view returns (uint256)',
    'function startTime() view returns (uint256)',
    'function endTime() view returns (uint256)',
    'function state() view returns (uint8)',
    'function raisedAmountUSDC() view returns (uint256)',
  ]);
  private equityReadInterface = new Interface([
    'function totalSupply() view returns (uint256)',
    'function admin() view returns (address)',
    'function propertyId() view returns (string)',
  ]);
  private profitReadInterface = new Interface([
    'function usdcToken() view returns (address)',
    'function equityToken() view returns (address)',
  ]);
  private dryRun: boolean;
  private deploymentBlock: number;
  private batchSize: number;
  private txSenderCache = new Map<string, string>();
  private forcedCrowdfundAddresses: string[];
  private forceStartBlock: boolean;
  private logAddressChunkSize: number;

  constructor(
    provider: JsonRpcProvider,
    db: Sequelize,
    options?: {
      dryRun?: boolean;
      deploymentBlock?: number;
      batchSize?: number;
      forcedCrowdfundAddresses?: string[];
      forceStartBlock?: boolean;
    }
  ) {
    this.provider = provider;
    this.db = db;
    this.dryRun = options?.dryRun ?? false;
    this.deploymentBlock = options?.deploymentBlock ?? 0;
    this.batchSize = options?.batchSize ?? DEFAULT_BATCH_SIZE;
    this.forcedCrowdfundAddresses = (options?.forcedCrowdfundAddresses ?? [])
      .map((value) => value.toLowerCase())
      .filter((value) => /^0x[a-f0-9]{40}$/.test(value));
    this.forceStartBlock = options?.forceStartBlock ?? false;
    this.logAddressChunkSize = Math.max(
      1,
      Number(process.env.INDEXER_LOG_ADDRESS_CHUNK_SIZE ?? DEFAULT_LOG_ADDRESS_CHUNK_SIZE)
    );
  }

  async sync(): Promise<void> {
    const network = await this.provider.getNetwork();
    const chainId = Number(network.chainId);
    await this.ensureIndexerState();

    const lastBlock = await this.getLastIndexedBlock(chainId);
    const latestBlock = await this.provider.getBlockNumber();
    const fromBlock = this.forceStartBlock
      ? this.deploymentBlock
      : Math.max(this.deploymentBlock, lastBlock - REORG_DEPTH);

    console.log(
      `[Indexer] sync_start chain=${chainId} latest=${latestBlock} lastIndexed=${lastBlock} deploymentBlock=${this.deploymentBlock} fromBlock=${fromBlock} forceStart=${this.forceStartBlock}`
    );

    await this.pruneReorgRange(fromBlock);

    for (let start = fromBlock; start <= latestBlock; start += this.batchSize) {
      const end = Math.min(latestBlock, start + this.batchSize - 1);
      await this.processBatch(chainId, start, end);
      await this.updateLastIndexedBlock(chainId, end);
    }
  }

  private async ensureIndexerState(): Promise<void> {
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
        chain_id BIGINT PRIMARY KEY,
        last_block BIGINT NOT NULL
      );
    `);
  }

  private async getLastIndexedBlock(chainId: number): Promise<number> {
    const [rows] = await this.db.query<{ last_block: string }>(
      'SELECT last_block FROM indexer_state WHERE chain_id = :chainId',
      { replacements: { chainId } }
    );
    if (rows.length === 0) {
      return this.deploymentBlock;
    }
    return Number(rows[0].last_block);
  }

  private async updateLastIndexedBlock(chainId: number, lastBlock: number): Promise<void> {
    if (this.dryRun) {
      return;
    }

    await this.db.query(
      `
      INSERT INTO indexer_state (chain_id, last_block)
      VALUES (:chainId, :lastBlock)
      ON CONFLICT (chain_id)
      DO UPDATE SET last_block = EXCLUDED.last_block;
    `,
      { replacements: { chainId, lastBlock } }
    );
  }

  private async pruneReorgRange(fromBlock: number): Promise<void> {
    if (this.dryRun) {
      return;
    }

    const tables = [
      'campaign_investments',
      'campaign_refunds',
      'equity_claims',
      'profit_deposits',
      'profit_claims',
    ];

    for (const table of tables) {
      await this.db.query(`DELETE FROM ${table} WHERE block_number >= :fromBlock`, {
        replacements: { fromBlock },
      });
    }

    await this.db.query(
      `
      UPDATE campaigns
      SET finalized_tx_hash = NULL,
          finalized_log_index = NULL,
          finalized_block_number = NULL
      WHERE finalized_block_number IS NOT NULL AND finalized_block_number >= :fromBlock;
    `,
      { replacements: { fromBlock } }
    );

    await this.db.query(`
      UPDATE campaigns
      SET raised_usdc_base_units = COALESCE(
        (SELECT SUM(usdc_amount_base_units) FROM campaign_investments WHERE campaign_id = campaigns.id),
        0
      ) - COALESCE(
        (SELECT SUM(usdc_amount_base_units) FROM campaign_refunds WHERE campaign_id = campaigns.id),
        0
      );
    `);
  }

  async processBatch(chainId: number, fromBlock: number, toBlock: number): Promise<void> {
    const campaigns = await this.getCampaigns(chainId);
    const knownCrowdfundAddresses = Array.from(
      new Set([
        ...(await this.getPropertyCrowdfundAddresses(chainId)),
        ...this.forcedCrowdfundAddresses,
      ])
    );
    const campaignMap = new Map(campaigns.map((c) => [c.contract_address.toLowerCase(), c]));

    // Ensure campaigns exist for crowdfund contracts stored by the intent worker.
    for (const address of knownCrowdfundAddresses) {
      if (campaignMap.has(address.toLowerCase())) {
        continue;
      }
      const ensured = await this.db.transaction((transaction) =>
        this.ensureCampaign(transaction, chainId, address.toLowerCase())
      );
      if (ensured) {
        campaigns.push(ensured);
        campaignMap.set(ensured.contract_address.toLowerCase(), ensured);
      }
    }

    const distributors = await this.getProfitDistributors(chainId);
    const distributorMap = new Map(distributors.map((d) => [d.contract_address.toLowerCase(), d]));

    const campaignAddresses = campaigns.map((campaign) => campaign.contract_address);
    const crowdfundLogs =
      campaignAddresses.length > 0
        ? await this.fetchLogs(
            campaignAddresses,
            [
              this.crowdfundInterface.getEvent('Invested').topicHash,
              this.crowdfundInterface.getEvent('Refunded').topicHash,
              this.crowdfundInterface.getEvent('Finalized').topicHash,
              this.crowdfundInterface.getEvent('Withdrawn').topicHash,
              this.crowdfundInterface.getEvent('TokensClaimed').topicHash,
              this.crowdfundInterface.getEvent('EquityTokenSet').topicHash,
            ],
            fromBlock,
            toBlock
          )
        : [];

    const distributorAddresses = distributors.map((d) => d.contract_address);

    const profitLogs =
      distributorAddresses.length > 0
        ? await this.fetchLogs(
            distributorAddresses,
            [
              this.profitInterface.getEvent('Deposited').topicHash,
              this.profitInterface.getEvent('Claimed').topicHash,
            ],
            fromBlock,
            toBlock
          )
        : [];

    const affectedCampaigns = new Set<string>();

    const inserts = {
      campaignInvestments: 0,
      campaignRefunds: 0,
      equityClaims: 0,
      profitDeposits: 0,
      profitClaims: 0,
      campaignsUpdated: 0,
    };

    const normalizedCrowdfundLogs = crowdfundLogs.map((log) => this.normalizeLog(log));
    const normalizedProfitLogs = profitLogs.map((log) => this.normalizeLog(log));

    const sortedCrowdfundLogs = [...normalizedCrowdfundLogs].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      return a.logIndex - b.logIndex;
    });

    const sortedProfitLogs = [...normalizedProfitLogs].sort((a, b) => {
      if (a.blockNumber !== b.blockNumber) {
        return a.blockNumber - b.blockNumber;
      }
      return a.logIndex - b.logIndex;
    });

    await this.db.transaction(async (transaction) => {
      for (const log of sortedCrowdfundLogs) {
        const parsed = this.crowdfundInterface.parseLog({ topics: log.topics, data: log.data });
        const contractAddress = log.address.toLowerCase();
        const campaign = campaignMap.get(contractAddress);
        if (!campaign) {
          continue;
        }

        switch (parsed.name) {
          case 'Invested': {
            const investor = String(parsed.args.investor).toLowerCase();
            const amount = parsed.args.amountUSDC as bigint;
            inserts.campaignInvestments += await this.insertCampaignInvestment(
              transaction,
              campaign,
              chainId,
              investor,
              amount,
              log
            );
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'invest',
                propertyId: campaign.property_id,
                campaignAddress: contractAddress,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
                metadata: { investor, usdcAmountBaseUnits: amount.toString() },
              },
              { transaction }
            );
            affectedCampaigns.add(campaign.id);
            break;
          }
          case 'Refunded': {
            const investor = String(parsed.args.investor).toLowerCase();
            const amount = parsed.args.amountUSDC as bigint;
            inserts.campaignRefunds += await this.insertCampaignRefund(
              transaction,
              campaign,
              chainId,
              investor,
              amount,
              log
            );
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'claim-refund',
                propertyId: campaign.property_id,
                campaignAddress: contractAddress,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
                metadata: { investor, usdcAmountBaseUnits: amount.toString() },
              },
              { transaction }
            );
            affectedCampaigns.add(campaign.id);
            break;
          }
          case 'Finalized': {
            const stateIndex = Number(parsed.args.state);
            const state = CROWDFUND_STATES[stateIndex] ?? 'ACTIVE';
            const raised = parsed.args.raisedAmountUSDC as bigint;
            await this.updateCampaignFinalized(
              transaction,
              campaign,
              state,
              raised,
              log
            );
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'campaign-finalize',
                propertyId: campaign.property_id,
                campaignAddress: contractAddress,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
              },
              { transaction }
            );
            inserts.campaignsUpdated += 1;
            break;
          }
          case 'Withdrawn': {
            await this.updateCampaignState(transaction, campaign, 'WITHDRAWN');
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'campaign-withdraw',
                propertyId: campaign.property_id,
                campaignAddress: contractAddress,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
              },
              { transaction }
            );
            inserts.campaignsUpdated += 1;
            break;
          }
          case 'EquityTokenSet': {
            const tokenAddress = String(parsed.args.equityToken).toLowerCase();
            await this.ensureEquityToken(
              transaction,
              chainId,
              campaign.property_id,
              tokenAddress,
              log,
              contractAddress
            );
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'campaign-repair-setup',
                propertyId: campaign.property_id,
                campaignAddress: contractAddress,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
                metadata: { equityTokenAddress: tokenAddress },
              },
              { transaction }
            );
            break;
          }
        }
      }

      for (const log of sortedCrowdfundLogs) {
        const parsed = this.crowdfundInterface.parseLog({ topics: log.topics, data: log.data });
        if (parsed.name !== 'TokensClaimed') {
          continue;
        }
        const contractAddress = log.address.toLowerCase();
        const campaign = campaignMap.get(contractAddress);
        if (!campaign) {
          continue;
        }
        const investor = String(parsed.args.investor).toLowerCase();
        const amount = parsed.args.amountEquityTokens as bigint;
        const equityTokenId = await this.lookupEquityTokenId(transaction, campaign.property_id);
        if (!equityTokenId) {
          continue;
        }
        inserts.equityClaims += await this.insertEquityClaim(
          transaction,
          campaign,
          equityTokenId,
          chainId,
          investor,
          amount,
          log
        );
        await markOnchainActivityIndexed(
          this.db,
          {
            chainId,
            txHash: log.transactionHash,
            activityType: 'claim-equity',
            propertyId: campaign.property_id,
            campaignAddress: contractAddress,
            blockNumber: log.blockNumber,
            logIndex: log.logIndex,
            metadata: { investor, equityAmountBaseUnits: amount.toString() },
          },
          { transaction }
        );
      }

      for (const log of sortedProfitLogs) {
        const parsed = this.profitInterface.parseLog({ topics: log.topics, data: log.data });
        const contractAddress = log.address.toLowerCase();
        let distributor = distributorMap.get(contractAddress);
        if (!distributor) {
          const ensured = await this.ensureProfitDistributor(transaction, chainId, contractAddress);
          if (!ensured) {
            continue;
          }
          distributor = ensured;
          distributorMap.set(contractAddress, ensured);
        }

        switch (parsed.name) {
          case 'Deposited': {
            const amount = parsed.args.amountUSDC as bigint;
            const accProfitPerShare = parsed.args.accProfitPerShare as bigint;
            const depositor = await this.getTransactionSender(log.transactionHash);
            inserts.profitDeposits += await this.insertProfitDeposit(
              transaction,
              distributor,
              chainId,
              depositor,
              amount,
              accProfitPerShare,
              log
            );
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'profit-deposit',
                propertyId: distributor.property_id,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
                metadata: {
                  depositor,
                  usdcAmountBaseUnits: amount.toString(),
                  accProfitPerShare: accProfitPerShare.toString(),
                },
              },
              { transaction }
            );
            break;
          }
          case 'Claimed': {
            const claimer = String(parsed.args.user).toLowerCase();
            const amount = parsed.args.amountUSDC as bigint;
            inserts.profitClaims += await this.insertProfitClaim(
              transaction,
              distributor,
              chainId,
              claimer,
              amount,
              log
            );
            await markOnchainActivityIndexed(
              this.db,
              {
                chainId,
                txHash: log.transactionHash,
                activityType: 'claim-profit',
                propertyId: distributor.property_id,
                blockNumber: log.blockNumber,
                logIndex: log.logIndex,
                metadata: { claimer, usdcAmountBaseUnits: amount.toString() },
              },
              { transaction }
            );
            break;
          }
        }
      }

      for (const campaignId of affectedCampaigns) {
        await this.recalculateRaised(transaction, campaignId);
      }
    });

    console.log(
      `[Indexer] ${fromBlock}-${toBlock} inserted: investments=${inserts.campaignInvestments}, refunds=${inserts.campaignRefunds}, equityClaims=${inserts.equityClaims}, profitDeposits=${inserts.profitDeposits}, profitClaims=${inserts.profitClaims}, campaignsUpdated=${inserts.campaignsUpdated}`
    );
  }

  private async fetchLogs(
    addresses: string[] | undefined,
    topic0: string[],
    fromBlock: number,
    toBlock: number
  ) {
    if (!addresses || addresses.length === 0) {
      return [];
    }

    const logs = [];
    for (let index = 0; index < addresses.length; index += this.logAddressChunkSize) {
      const chunk = addresses.slice(index, index + this.logAddressChunkSize);
      const chunkLogs = await this.provider.getLogs({
        address: chunk,
        fromBlock,
        toBlock,
        topics: [topic0],
      });
      logs.push(...chunkLogs);
    }

    return logs;
  }

  private normalizeLog(log: any): ParsedChainLog {
    return {
      address: String(log.address).toLowerCase(),
      topics: Array.isArray(log.topics) ? log.topics : [],
      data: String(log.data ?? '0x'),
      transactionHash: String(log.transactionHash),
      blockNumber: Number(log.blockNumber),
      // ethers v6 log objects can expose `index` instead of `logIndex`
      logIndex: Number(log.logIndex ?? log.index ?? 0),
    };
  }

  private async ensureCampaign(
    transaction: Transaction,
    chainId: number,
    contractAddress: string
  ): Promise<CampaignRow | null> {
    const lowerAddress = contractAddress.toLowerCase();
    const existing = await this.getCampaignByAddress(lowerAddress, transaction);
    if (existing) {
      return existing;
    }

    const metadata = await this.readCrowdfundMetadata(lowerAddress);
    if (!metadata) {
      return null;
    }

    const propertyId = await this.ensureProperty(transaction, chainId, lowerAddress, metadata);
    const state = CROWDFUND_STATES[metadata.stateIndex] ?? 'ACTIVE';

    if (this.dryRun) {
      return {
        id: '00000000-0000-0000-0000-000000000001',
        property_id: propertyId,
        contract_address: lowerAddress,
      };
    }

    await this.db.query(
      `
      INSERT INTO campaigns (
        id,
        property_id,
        chain_id,
        contract_address,
        start_time,
        end_time,
        state,
        target_usdc_base_units,
        raised_usdc_base_units
      ) VALUES (
        gen_random_uuid(),
        :propertyId,
        :chainId,
        :contractAddress,
        to_timestamp(:startTime),
        to_timestamp(:endTime),
        :state,
        :targetAmount,
        :raisedAmount
      )
      ON CONFLICT (contract_address) DO NOTHING;
    `,
      {
        replacements: {
          propertyId,
          chainId,
          contractAddress: lowerAddress,
          startTime: metadata.startTime,
          endTime: metadata.endTime,
          state,
          targetAmount: metadata.targetAmount.toString(),
          raisedAmount: metadata.raisedAmount.toString(),
        },
        transaction,
      }
    );

    return this.getCampaignByAddress(lowerAddress, transaction);
  }

  private async ensureProperty(
    transaction: Transaction,
    chainId: number,
    contractAddress: string,
    metadata: {
      propertyId: string;
      targetAmount: bigint;
    }
  ): Promise<string> {
    const existing = await this.getPropertyByCrowdfund(contractAddress, transaction);
    if (existing) {
      return existing;
    }

    if (this.dryRun) {
      return '00000000-0000-0000-0000-000000000000';
    }

    await this.db.query(
      `
      INSERT INTO properties (
        id,
        property_id,
        chain_id,
        crowdfund_contract_address,
        target_usdc_base_units
      ) VALUES (
        gen_random_uuid(),
        :propertyId,
        :chainId,
        :contractAddress,
        :targetAmount
      )
      ON CONFLICT (crowdfund_contract_address) DO NOTHING;
    `,
      {
        replacements: {
          propertyId: metadata.propertyId,
          chainId,
          contractAddress,
          targetAmount: metadata.targetAmount.toString(),
        },
        transaction,
      }
    );

    return (
      (await this.getPropertyByCrowdfund(contractAddress, transaction)) ??
      '00000000-0000-0000-0000-000000000000'
    );
  }

  private async getPropertyByCrowdfund(
    contractAddress: string,
    transaction?: Transaction
  ): Promise<string | null> {
    const [rows] = await this.db.query<{ id: string }>(
      'SELECT id FROM properties WHERE crowdfund_contract_address = :address LIMIT 1',
      { replacements: { address: contractAddress }, transaction }
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0].id;
  }

  private async getCampaignByAddress(
    contractAddress: string,
    transaction?: Transaction
  ): Promise<CampaignRow | null> {
    const [rows] = await this.db.query<CampaignRow>(
      'SELECT id, property_id, contract_address FROM campaigns WHERE contract_address = :address LIMIT 1',
      { replacements: { address: contractAddress }, transaction }
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  }

  private async readCrowdfundMetadata(contractAddress: string): Promise<{
    propertyId: string;
    targetAmount: bigint;
    startTime: number;
    endTime: number;
    stateIndex: number;
    raisedAmount: bigint;
  } | null> {
    try {
      const propertyId = await this.callString(contractAddress, 'propertyId');
      const targetAmount = await this.callUint(contractAddress, 'targetAmountUSDC');
      const startTime = Number(await this.callUint(contractAddress, 'startTime'));
      const endTime = Number(await this.callUint(contractAddress, 'endTime'));
      const stateIndex = Number(await this.callUint(contractAddress, 'state'));
      const raisedAmount = await this.callUint(contractAddress, 'raisedAmountUSDC');
      return { propertyId, targetAmount, startTime, endTime, stateIndex, raisedAmount };
    } catch (error) {
      console.warn(`[Indexer] Failed to read crowdfund metadata for ${contractAddress}:`, error);
      return null;
    }
  }

  private async callUint(contractAddress: string, fn: string): Promise<bigint> {
    const data = this.crowdfundReadInterface.encodeFunctionData(fn, []);
    const result = await this.provider.call({ to: contractAddress, data });
    const [value] = this.crowdfundReadInterface.decodeFunctionResult(fn, result);
    return value as bigint;
  }

  private async callString(contractAddress: string, fn: string): Promise<string> {
    const data = this.crowdfundReadInterface.encodeFunctionData(fn, []);
    const result = await this.provider.call({ to: contractAddress, data });
    const [value] = this.crowdfundReadInterface.decodeFunctionResult(fn, result);
    return value as string;
  }

  private async getCampaigns(chainId: number): Promise<CampaignRow[]> {
    const [rows] = await this.db.query<CampaignRow>(
      'SELECT id, property_id, contract_address FROM campaigns WHERE chain_id = :chainId',
      { replacements: { chainId } }
    );
    return rows;
  }

  private async getPropertyCrowdfundAddresses(chainId: number): Promise<string[]> {
    const [rows] = await this.db.query<{ contract_address: string }>(
      `
      SELECT DISTINCT LOWER(crowdfund_contract_address) AS contract_address
      FROM properties
      WHERE chain_id = :chainId
        AND crowdfund_contract_address IS NOT NULL
      `,
      { replacements: { chainId } }
    );
    return rows.map((row) => row.contract_address).filter(Boolean);
  }

  private async getProfitDistributors(chainId: number): Promise<ProfitDistributorRow[]> {
    const [rows] = await this.db.query<ProfitDistributorRow>(
      'SELECT id, property_id, contract_address FROM profit_distributors WHERE chain_id = :chainId',
      { replacements: { chainId } }
    );
    return rows;
  }

  private async ensureProfitDistributor(
    transaction: Transaction,
    chainId: number,
    contractAddress: string
  ): Promise<ProfitDistributorRow | null> {
    const existing = await this.getProfitDistributorByAddress(contractAddress, transaction);
    if (existing) {
      return existing;
    }

    try {
      const usdcToken = await this.callProfitAddress(contractAddress, 'usdcToken');
      const equityToken = await this.callProfitAddress(contractAddress, 'equityToken');
      const propertyId = await this.lookupPropertyIdByEquityToken(equityToken, transaction);
      if (!propertyId) {
        console.warn(`[Indexer] ProfitDistributor ${contractAddress} missing property mapping; skipping`);
        return null;
      }

      if (!this.dryRun) {
        const deployment = await this.findContractDeployment(contractAddress);
        await this.db.query(
          `
          INSERT INTO profit_distributors (
            id,
            property_id,
            chain_id,
            contract_address,
            usdc_token_address,
            equity_token_address,
            created_tx_hash,
            created_log_index,
            created_block_number
          ) VALUES (
            gen_random_uuid(),
            :propertyId,
            :chainId,
            :contractAddress,
            :usdcToken,
            :equityToken,
            :txHash,
            :logIndex,
            :blockNumber
          ) ON CONFLICT (contract_address) DO NOTHING;
        `,
          {
            replacements: {
              propertyId,
              chainId,
              contractAddress,
              usdcToken,
              equityToken,
              txHash: deployment?.txHash ?? '0x',
              logIndex: deployment?.logIndex ?? 0,
              blockNumber: deployment?.blockNumber ?? 0,
            },
            transaction,
          }
        );
      }

      return this.getProfitDistributorByAddress(contractAddress, transaction);
    } catch (error) {
      console.warn(`[Indexer] Failed to read ProfitDistributor metadata for ${contractAddress}:`, error);
      return null;
    }
  }

  private async getProfitDistributorByAddress(
    contractAddress: string,
    transaction?: Transaction
  ): Promise<ProfitDistributorRow | null> {
    const [rows] = await this.db.query<ProfitDistributorRow>(
      'SELECT id, property_id, contract_address FROM profit_distributors WHERE contract_address = :address LIMIT 1',
      { replacements: { address: contractAddress }, transaction }
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0];
  }

  private async lookupPropertyIdByEquityToken(
    equityToken: string,
    transaction?: Transaction
  ): Promise<string | null> {
    const [rows] = await this.db.query<{ property_id: string }>(
      'SELECT property_id FROM equity_tokens WHERE contract_address = :address LIMIT 1',
      { replacements: { address: equityToken }, transaction }
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0].property_id;
  }

  private async getTransactionSender(txHash: string): Promise<string> {
    const cached = this.txSenderCache.get(txHash);
    if (cached) {
      return cached;
    }
    const tx = await this.provider.getTransaction(txHash);
    const sender = tx?.from?.toLowerCase() ?? '0x0000000000000000000000000000000000000000';
    this.txSenderCache.set(txHash, sender);
    return sender;
  }

  private async insertCampaignInvestment(
    transaction: Transaction,
    campaign: CampaignRow,
    chainId: number,
    investor: string,
    amount: bigint,
    log: { transactionHash: string; logIndex: number; blockNumber: number }
  ): Promise<number> {
    if (this.dryRun) {
      return 0;
    }

    const [result] = await this.db.query<{ id: string }>(
      `
      INSERT INTO campaign_investments (
        id,
        campaign_id,
        property_id,
        chain_id,
        investor_address,
        usdc_amount_base_units,
        tx_hash,
        log_index,
        block_number
      ) VALUES (
        gen_random_uuid(),
        :campaignId,
        :propertyId,
        :chainId,
        :investor,
        :amount,
        :txHash,
        :logIndex,
        :blockNumber
      ) ON CONFLICT (tx_hash, log_index) DO NOTHING
      RETURNING id;
    `,
      {
        replacements: {
          campaignId: campaign.id,
          propertyId: campaign.property_id,
          chainId,
          investor,
          amount: amount.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );

    return result.length;
  }

  private async insertCampaignRefund(
    transaction: Transaction,
    campaign: CampaignRow,
    chainId: number,
    investor: string,
    amount: bigint,
    log: { transactionHash: string; logIndex: number; blockNumber: number }
  ): Promise<number> {
    if (this.dryRun) {
      return 0;
    }

    const [result] = await this.db.query<{ id: string }>(
      `
      INSERT INTO campaign_refunds (
        id,
        campaign_id,
        property_id,
        chain_id,
        investor_address,
        usdc_amount_base_units,
        tx_hash,
        log_index,
        block_number
      ) VALUES (
        gen_random_uuid(),
        :campaignId,
        :propertyId,
        :chainId,
        :investor,
        :amount,
        :txHash,
        :logIndex,
        :blockNumber
      ) ON CONFLICT (tx_hash, log_index) DO NOTHING
      RETURNING id;
    `,
      {
        replacements: {
          campaignId: campaign.id,
          propertyId: campaign.property_id,
          chainId,
          investor,
          amount: amount.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );

    return result.length;
  }

  private async updateCampaignFinalized(
    transaction: Transaction,
    campaign: CampaignRow,
    state: CrowdfundState,
    raised: bigint,
    log: { transactionHash: string; logIndex: number; blockNumber: number }
  ): Promise<void> {
    if (this.dryRun) {
      return;
    }

    await this.db.query(
      `
      UPDATE campaigns
      SET state = :state,
          raised_usdc_base_units = :raised,
          finalized_tx_hash = :txHash,
          finalized_log_index = :logIndex,
          finalized_block_number = :blockNumber,
          updated_at = NOW()
      WHERE id = :campaignId;
    `,
      {
        replacements: {
          campaignId: campaign.id,
          state,
          raised: raised.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );
  }

  private async updateCampaignState(
    transaction: Transaction,
    campaign: CampaignRow,
    state: CrowdfundState
  ): Promise<void> {
    if (this.dryRun) {
      return;
    }

    await this.db.query(
      `
      UPDATE campaigns
      SET state = :state,
          updated_at = NOW()
      WHERE id = :campaignId;
    `,
      {
        replacements: { campaignId: campaign.id, state },
        transaction,
      }
    );
  }

  private async lookupEquityTokenId(transaction: Transaction, propertyId: string): Promise<string | null> {
    const [rows] = await this.db.query<{ id: string }>(
      'SELECT id FROM equity_tokens WHERE property_id = :propertyId LIMIT 1',
      { replacements: { propertyId }, transaction }
    );
    if (rows.length === 0) {
      return null;
    }
    return rows[0].id;
  }

  private async insertEquityClaim(
    transaction: Transaction,
    campaign: CampaignRow,
    equityTokenId: string,
    chainId: number,
    investor: string,
    amount: bigint,
    log: { transactionHash: string; logIndex: number; blockNumber: number }
  ): Promise<number> {
    if (this.dryRun) {
      return 0;
    }

    const [result] = await this.db.query<{ id: string }>(
      `
      INSERT INTO equity_claims (
        id,
        campaign_id,
        property_id,
        equity_token_id,
        chain_id,
        claimant_address,
        equity_amount_base_units,
        tx_hash,
        log_index,
        block_number
      ) VALUES (
        gen_random_uuid(),
        :campaignId,
        :propertyId,
        :equityTokenId,
        :chainId,
        :claimant,
        :amount,
        :txHash,
        :logIndex,
        :blockNumber
      ) ON CONFLICT (tx_hash, log_index) DO NOTHING
      RETURNING id;
    `,
      {
        replacements: {
          campaignId: campaign.id,
          propertyId: campaign.property_id,
          equityTokenId,
          chainId,
          claimant: investor,
          amount: amount.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );

    return result.length;
  }

  private async insertProfitDeposit(
    transaction: Transaction,
    distributor: ProfitDistributorRow,
    chainId: number,
    depositor: string,
    amount: bigint,
    accProfitPerShare: bigint,
    log: { transactionHash: string; logIndex: number; blockNumber: number }
  ): Promise<number> {
    if (this.dryRun) {
      return 0;
    }

    const [result] = await this.db.query<{ id: string }>(
      `
      INSERT INTO profit_deposits (
        id,
        profit_distributor_id,
        property_id,
        chain_id,
        depositor_address,
        usdc_amount_base_units,
        acc_profit_per_share,
        tx_hash,
        log_index,
        block_number
      ) VALUES (
        gen_random_uuid(),
        :distributorId,
        :propertyId,
        :chainId,
        :depositor,
        :amount,
        :accProfitPerShare,
        :txHash,
        :logIndex,
        :blockNumber
      ) ON CONFLICT (tx_hash, log_index) DO NOTHING
      RETURNING id;
    `,
      {
        replacements: {
          distributorId: distributor.id,
          propertyId: distributor.property_id,
          chainId,
          depositor,
          amount: amount.toString(),
          accProfitPerShare: accProfitPerShare.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );

    return result.length;
  }

  private async insertProfitClaim(
    transaction: Transaction,
    distributor: ProfitDistributorRow,
    chainId: number,
    claimer: string,
    amount: bigint,
    log: { transactionHash: string; logIndex: number; blockNumber: number }
  ): Promise<number> {
    if (this.dryRun) {
      return 0;
    }

    const [result] = await this.db.query<{ id: string }>(
      `
      INSERT INTO profit_claims (
        id,
        profit_distributor_id,
        property_id,
        chain_id,
        claimer_address,
        usdc_amount_base_units,
        tx_hash,
        log_index,
        block_number
      ) VALUES (
        gen_random_uuid(),
        :distributorId,
        :propertyId,
        :chainId,
        :claimer,
        :amount,
        :txHash,
        :logIndex,
        :blockNumber
      ) ON CONFLICT (tx_hash, log_index) DO NOTHING
      RETURNING id;
    `,
      {
        replacements: {
          distributorId: distributor.id,
          propertyId: distributor.property_id,
          chainId,
          claimer,
          amount: amount.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );

    return result.length;
  }

  private async recalculateRaised(transaction: Transaction, campaignId: string): Promise<void> {
    if (this.dryRun) {
      return;
    }

    await this.db.query(
      `
      UPDATE campaigns
      SET raised_usdc_base_units = (
        SELECT COALESCE(SUM(usdc_amount_base_units), 0)
        FROM campaign_investments
        WHERE campaign_id = :campaignId
      ) - (
        SELECT COALESCE(SUM(usdc_amount_base_units), 0)
        FROM campaign_refunds
        WHERE campaign_id = :campaignId
      )
      WHERE id = :campaignId;
    `,
      { replacements: { campaignId }, transaction }
    );
  }

  private async ensureEquityToken(
    transaction: Transaction,
    chainId: number,
    propertyId: string,
    tokenAddress: string,
    log: { transactionHash: string; logIndex: number; blockNumber: number },
    initialHolder: string
  ): Promise<void> {
    const [rows] = await this.db.query<{ id: string }>(
      'SELECT id FROM equity_tokens WHERE contract_address = :address LIMIT 1',
      { replacements: { address: tokenAddress }, transaction }
    );
    if (rows.length > 0) {
      return;
    }

    const totalSupply = await this.callEquityUint(tokenAddress, 'totalSupply');
    const admin = await this.callEquityAddress(tokenAddress, 'admin');
    const propertyIdString = await this.callEquityString(tokenAddress, 'propertyId');

    if (this.dryRun) {
      console.log(`[Indexer] (dry-run) discovered equity token ${tokenAddress}`);
      return;
    }

    await this.db.query(
      `
      INSERT INTO equity_tokens (
        id,
        property_id,
        chain_id,
        contract_address,
        property_id_string,
        admin_address,
        initial_holder_address,
        total_supply_base_units,
        created_tx_hash,
        created_log_index,
        created_block_number
      ) VALUES (
        gen_random_uuid(),
        :propertyId,
        :chainId,
        :contractAddress,
        :propertyIdString,
        :adminAddress,
        :initialHolder,
        :totalSupply,
        :txHash,
        :logIndex,
        :blockNumber
      ) ON CONFLICT (contract_address) DO NOTHING;
    `,
      {
        replacements: {
          propertyId,
          chainId,
          contractAddress: tokenAddress,
          propertyIdString,
          adminAddress: admin,
          initialHolder,
          totalSupply: totalSupply.toString(),
          txHash: log.transactionHash,
          logIndex: log.logIndex,
          blockNumber: log.blockNumber,
        },
        transaction,
      }
    );
  }

  private async callEquityUint(contractAddress: string, fn: string): Promise<bigint> {
    const data = this.equityReadInterface.encodeFunctionData(fn, []);
    const result = await this.provider.call({ to: contractAddress, data });
    const [value] = this.equityReadInterface.decodeFunctionResult(fn, result);
    return value as bigint;
  }

  private async callEquityString(contractAddress: string, fn: string): Promise<string> {
    const data = this.equityReadInterface.encodeFunctionData(fn, []);
    const result = await this.provider.call({ to: contractAddress, data });
    const [value] = this.equityReadInterface.decodeFunctionResult(fn, result);
    return value as string;
  }

  private async callEquityAddress(contractAddress: string, fn: string): Promise<string> {
    const data = this.equityReadInterface.encodeFunctionData(fn, []);
    const result = await this.provider.call({ to: contractAddress, data });
    const [value] = this.equityReadInterface.decodeFunctionResult(fn, result);
    return String(value).toLowerCase();
  }

  private async callProfitAddress(contractAddress: string, fn: string): Promise<string> {
    const data = this.profitReadInterface.encodeFunctionData(fn, []);
    const result = await this.provider.call({ to: contractAddress, data });
    const [value] = this.profitReadInterface.decodeFunctionResult(fn, result);
    return String(value).toLowerCase();
  }

  private async findContractDeployment(
    contractAddress: string
  ): Promise<{ txHash: string; logIndex: number; blockNumber: number } | null> {
    const logs = await this.provider.getLogs({
      address: contractAddress,
      fromBlock: this.deploymentBlock,
      toBlock: 'latest',
    });
    if (logs.length === 0) {
      return null;
    }
    const log = logs[0];
    return {
      txHash: log.transactionHash,
      logIndex: log.logIndex,
      blockNumber: log.blockNumber,
    };
  }
}
