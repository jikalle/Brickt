import { Response } from 'express';
import { Interface, JsonRpcProvider } from 'ethers';
import { QueryTypes } from 'sequelize';
import { sequelize } from '../../db/index.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sendError } from '../../lib/apiError.js';
import {
  BASE_SEPOLIA_CHAIN_ID,
  ValidationError,
  normalizeAddress,
  parseEventCursor,
  parseLimit,
} from '../../validators/v1.js';

const handleError = (res: Response, error: unknown) => {
  if (error instanceof ValidationError) {
    return sendError(res, error.status, error.message, 'validation_error');
  }
  console.error(error);
  return sendError(res, 500, 'Internal server error', 'internal_error');
};

const requireUserAddress = (req: AuthenticatedRequest): string => {
  if (!req.user?.address) {
    throw new ValidationError('Unauthorized', 401);
  }
  return normalizeAddress(req.user.address, 'address');
};

type InvestmentRow = {
  propertyId: string;
  campaignAddress: string;
  investorAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

type EquityClaimRow = {
  propertyId: string;
  equityTokenAddress: string;
  campaignAddress: string | null;
  claimantAddress: string;
  equityAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

type ProfitClaimRow = {
  propertyId: string;
  profitDistributorAddress: string;
  claimerAddress: string;
  usdcAmountBaseUnits: string;
  txHash: string;
  logIndex: number;
  blockNumber: string;
  createdAt: string;
};

type ProfitStatusRow = {
  propertyId: string;
  profitDistributorAddress: string;
  campaignAddress: string | null;
  campaignState: string | null;
  equityTokenAddress: string | null;
  contributedBaseUnits: string;
  equityClaimedBaseUnits: string;
  totalDepositedBaseUnits: string;
  totalClaimedBaseUnits: string;
  unclaimedPoolBaseUnits: string;
  lastDepositAt: string | null;
};

const distributorReadInterface = new Interface([
  'function claimable(address user) view returns (uint256)',
]);
const crowdfundReadInterface = new Interface([
  'function claimableTokens(address investor) view returns (uint256)',
]);
const erc20ReadInterface = new Interface([
  'function balanceOf(address account) view returns (uint256)',
]);

export const listMyInvestments = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorAddress = requireUserAddress(req);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: InvestmentRow[] = await sequelize.query<InvestmentRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(c.contract_address) AS "campaignAddress",
        LOWER(ci.investor_address) AS "investorAddress",
        ci.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        ci.tx_hash AS "txHash",
        ci.log_index AS "logIndex",
        ci.block_number::text AS "blockNumber",
        ci.created_at AS "createdAt"
      FROM campaign_investments ci
      JOIN campaigns c ON c.id = ci.campaign_id
      JOIN properties p ON p.id = ci.property_id
      WHERE ci.chain_id = :chainId
        AND c.chain_id = :chainId
        AND LOWER(ci.investor_address) = LOWER(:investorAddress)
        ${
          cursor
            ? 'AND (ci.block_number, ci.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY ci.block_number ASC, ci.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          investorAddress,
          cursorBlockNumber: eventCursor?.blockNumber,
          cursorLogIndex: eventCursor?.logIndex,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? {
            cursorBlockNumber: items[items.length - 1]?.blockNumber,
            cursorLogIndex: items[items.length - 1]?.logIndex,
          }
        : null;

    return res.json({ investments: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listMyEquityClaims = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const claimantAddress = requireUserAddress(req);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: EquityClaimRow[] = await sequelize.query<EquityClaimRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(et.contract_address) AS "equityTokenAddress",
        LOWER(c.contract_address) AS "campaignAddress",
        LOWER(ec.claimant_address) AS "claimantAddress",
        ec.equity_amount_base_units::text AS "equityAmountBaseUnits",
        ec.tx_hash AS "txHash",
        ec.log_index AS "logIndex",
        ec.block_number::text AS "blockNumber",
        ec.created_at AS "createdAt"
      FROM equity_claims ec
      JOIN equity_tokens et ON et.id = ec.equity_token_id
      JOIN properties p ON p.id = ec.property_id
      LEFT JOIN campaigns c ON c.id = ec.campaign_id
      WHERE ec.chain_id = :chainId
        AND LOWER(ec.claimant_address) = LOWER(:claimantAddress)
        ${
          cursor
            ? 'AND (ec.block_number, ec.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY ec.block_number ASC, ec.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          claimantAddress,
          cursorBlockNumber: eventCursor?.blockNumber,
          cursorLogIndex: eventCursor?.logIndex,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? {
            cursorBlockNumber: items[items.length - 1]?.blockNumber,
            cursorLogIndex: items[items.length - 1]?.logIndex,
          }
        : null;

    return res.json({ equityClaims: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listMyProfitClaims = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const claimerAddress = requireUserAddress(req);
    const limit = parseLimit(req.query.limit);
    const cursor = parseEventCursor(req.query);
    const eventCursor = cursor
      ? { blockNumber: cursor.cursorBlockNumber, logIndex: cursor.cursorLogIndex }
      : null;
    const limitPlus = limit + 1;

    const rows: ProfitClaimRow[] = await sequelize.query<ProfitClaimRow>(
      `
      SELECT
        p.property_id AS "propertyId",
        LOWER(pdistr.contract_address) AS "profitDistributorAddress",
        LOWER(pc.claimer_address) AS "claimerAddress",
        pc.usdc_amount_base_units::text AS "usdcAmountBaseUnits",
        pc.tx_hash AS "txHash",
        pc.log_index AS "logIndex",
        pc.block_number::text AS "blockNumber",
        pc.created_at AS "createdAt"
      FROM profit_claims pc
      JOIN profit_distributors pdistr ON pdistr.id = pc.profit_distributor_id
      JOIN properties p ON p.id = pc.property_id
      WHERE pc.chain_id = :chainId
        AND LOWER(pc.claimer_address) = LOWER(:claimerAddress)
        ${
          cursor
            ? 'AND (pc.block_number, pc.log_index) > (:cursorBlockNumber, :cursorLogIndex)'
            : ''
        }
      ORDER BY pc.block_number ASC, pc.log_index ASC
      LIMIT :limitPlus
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          claimerAddress,
          cursorBlockNumber: eventCursor?.blockNumber,
          cursorLogIndex: eventCursor?.logIndex,
          limitPlus,
        },
      }
    );

    const items = rows.slice(0, limit);
    const nextCursor =
      rows.length > limit
        ? {
            cursorBlockNumber: items[items.length - 1]?.blockNumber,
            cursorLogIndex: items[items.length - 1]?.logIndex,
          }
        : null;

    return res.json({ profitClaims: items, nextCursor });
  } catch (error) {
    return handleError(res, error);
  }
};

export const listMyProfitStatus = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const investorAddress = requireUserAddress(req);
    const rows: ProfitStatusRow[] = await sequelize.query<ProfitStatusRow>(
      `
      WITH invested AS (
        SELECT DISTINCT
          p.id,
          p.property_id,
          LOWER(p.profit_distributor_address) AS profit_distributor_address,
          LOWER(p.crowdfund_contract_address) AS campaign_address,
          LOWER(p.equity_token_address) AS equity_token_address,
          c.state AS campaign_state
        FROM campaign_investments ci
        JOIN properties p ON p.id = ci.property_id
        LEFT JOIN campaigns c
          ON c.property_id = p.id
         AND c.chain_id = :chainId
        WHERE ci.chain_id = :chainId
          AND LOWER(ci.investor_address) = LOWER(:investorAddress)
      )
      SELECT
        invested.property_id AS "propertyId",
        invested.profit_distributor_address AS "profitDistributorAddress",
        invested.campaign_address AS "campaignAddress",
        invested.campaign_state AS "campaignState",
        invested.equity_token_address AS "equityTokenAddress",
        COALESCE(contrib.total_contributed, 0)::text AS "contributedBaseUnits",
        COALESCE(eqc.total_claimed, 0)::text AS "equityClaimedBaseUnits",
        COALESCE(dep.total_deposited, 0)::text AS "totalDepositedBaseUnits",
        COALESCE(clm.total_claimed, 0)::text AS "totalClaimedBaseUnits",
        (COALESCE(dep.total_deposited, 0) - COALESCE(clm.total_claimed, 0))::text AS "unclaimedPoolBaseUnits",
        dep.last_deposit_at AS "lastDepositAt"
      FROM invested
      LEFT JOIN LATERAL (
        SELECT
          COALESCE(SUM(ci.usdc_amount_base_units), 0)
          -
          COALESCE((
            SELECT SUM(cr.usdc_amount_base_units)
            FROM campaign_refunds cr
            WHERE cr.chain_id = :chainId
              AND cr.property_id = invested.id
              AND LOWER(cr.investor_address) = LOWER(:investorAddress)
          ), 0) AS total_contributed
        FROM campaign_investments ci
        WHERE ci.chain_id = :chainId
          AND ci.property_id = invested.id
          AND LOWER(ci.investor_address) = LOWER(:investorAddress)
      ) contrib ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(ec.equity_amount_base_units) AS total_claimed
        FROM equity_claims ec
        WHERE ec.chain_id = :chainId
          AND ec.property_id = invested.id
          AND LOWER(ec.claimant_address) = LOWER(:investorAddress)
      ) eqc ON TRUE
      LEFT JOIN LATERAL (
        SELECT
          SUM(pd.usdc_amount_base_units) AS total_deposited,
          MAX(pd.created_at) AS last_deposit_at
        FROM profit_deposits pd
        WHERE pd.chain_id = :chainId
          AND pd.property_id = invested.id
      ) dep ON TRUE
      LEFT JOIN LATERAL (
        SELECT SUM(pc.usdc_amount_base_units) AS total_claimed
        FROM profit_claims pc
        WHERE pc.chain_id = :chainId
          AND pc.property_id = invested.id
      ) clm ON TRUE
      ORDER BY invested.property_id ASC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: {
          chainId: BASE_SEPOLIA_CHAIN_ID,
          investorAddress,
        },
      }
    );

    const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
    if (!rpcUrl) {
      return res.json({
        statuses: rows.map((row) => ({
          ...row,
          claimableBaseUnits: null,
          claimableError: 'RPC unavailable',
          equityWalletBalanceBaseUnits: null,
          claimableTokensBaseUnits: null,
          claimableTokensError: 'RPC unavailable',
          diagnostics: {
            profitReady: false,
            equityReady: false,
            profitReasons: ['rpc-unavailable'],
            equityReasons: ['rpc-unavailable'],
          },
        })),
      });
    }

    const provider = new JsonRpcProvider(rpcUrl);
    const statuses = await Promise.all(
      rows.map(async (row) => {
        const profitReasons: string[] = [];
        const equityReasons: string[] = [];
        const totalDeposited = BigInt(row.totalDepositedBaseUnits || '0');
        const totalClaimed = BigInt(row.totalClaimedBaseUnits || '0');
        const unclaimedPool = BigInt(row.unclaimedPoolBaseUnits || '0');
        const contributed = BigInt(row.contributedBaseUnits || '0');

        let claimableBaseUnits: string | null = null;
        let claimableError: string | null = null;
        let equityWalletBalanceBaseUnits: string | null = null;
        let claimableTokensBaseUnits: string | null = null;
        let claimableTokensError: string | null = null;

        try {
          const data = distributorReadInterface.encodeFunctionData('claimable', [investorAddress]);
          const raw = await provider.call({
            to: row.profitDistributorAddress,
            data,
          });
          const [claimable] = distributorReadInterface.decodeFunctionResult('claimable', raw);
          claimableBaseUnits = claimable.toString();
        } catch (error) {
          claimableError = error instanceof Error ? error.message : 'claimable-read-failed';
        }

        if (row.equityTokenAddress) {
          try {
            const balanceData = erc20ReadInterface.encodeFunctionData('balanceOf', [investorAddress]);
            const balanceRaw = await provider.call({
              to: row.equityTokenAddress,
              data: balanceData,
            });
            const [balance] = erc20ReadInterface.decodeFunctionResult('balanceOf', balanceRaw);
            equityWalletBalanceBaseUnits = balance.toString();
          } catch (_error) {
            equityWalletBalanceBaseUnits = null;
          }
        }

        if (row.campaignAddress) {
          try {
            const claimableTokensData = crowdfundReadInterface.encodeFunctionData('claimableTokens', [
              investorAddress,
            ]);
            const claimableTokensRaw = await provider.call({
              to: row.campaignAddress,
              data: claimableTokensData,
            });
            const [claimableTokens] = crowdfundReadInterface.decodeFunctionResult(
              'claimableTokens',
              claimableTokensRaw
            );
            claimableTokensBaseUnits = claimableTokens.toString();
          } catch (error) {
            claimableTokensError =
              error instanceof Error ? error.message : 'claimable-tokens-read-failed';
          }
        }

        if (!row.profitDistributorAddress) {
          profitReasons.push('missing-profit-distributor');
        }
        if (totalDeposited <= 0n) {
          profitReasons.push('no-profit-deposits');
        }
        if (unclaimedPool <= 0n || totalClaimed >= totalDeposited) {
          profitReasons.push('no-unclaimed-profit-pool');
        }
        if (equityWalletBalanceBaseUnits !== null && BigInt(equityWalletBalanceBaseUnits) <= 0n) {
          profitReasons.push('no-equity-balance');
        }
        if (claimableError) {
          profitReasons.push('profit-claimable-read-failed');
        } else if (claimableBaseUnits !== null && BigInt(claimableBaseUnits) <= 0n) {
          profitReasons.push('no-profit-claimable');
        }

        const campaignState = (row.campaignState || '').toUpperCase();
        if (campaignState !== 'SUCCESS' && campaignState !== 'WITHDRAWN') {
          equityReasons.push('campaign-not-successful');
        }
        if (!row.equityTokenAddress) {
          equityReasons.push('equity-token-not-set');
        }
        if (contributed <= 0n) {
          equityReasons.push('no-contribution');
        }
        if (claimableTokensError) {
          equityReasons.push('equity-claimable-read-failed');
        } else if (claimableTokensBaseUnits !== null && BigInt(claimableTokensBaseUnits) <= 0n) {
          equityReasons.push('no-equity-claimable');
        }

        return {
          ...row,
          claimableBaseUnits,
          claimableError,
          equityWalletBalanceBaseUnits,
          claimableTokensBaseUnits,
          claimableTokensError,
          diagnostics: {
            profitReady:
              !claimableError &&
              claimableBaseUnits !== null &&
              BigInt(claimableBaseUnits) > 0n,
            equityReady:
              !claimableTokensError &&
              claimableTokensBaseUnits !== null &&
              BigInt(claimableTokensBaseUnits) > 0n,
            profitReasons,
            equityReasons,
          },
        };
      })
    );

    return res.json({ statuses });
  } catch (error) {
    return handleError(res, error);
  }
};
