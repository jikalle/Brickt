import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { ContractFactory, JsonRpcProvider, NonceManager, Wallet } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const operatorKey =
  process.env.PROPERTY_OPERATOR_PRIVATE_KEY ||
  process.env.PLATFORM_OPERATOR_PRIVATE_KEY ||
  process.env.PRIVATE_KEY ||
  '';
const batchSize = Number(process.env.PROPERTY_INTENT_BATCH_SIZE || 10);
const maxAttempts = Number(process.env.PROPERTY_INTENT_MAX_ATTEMPTS || 3);
const startDelaySeconds = Number(process.env.PROPERTY_INTENT_START_DELAY_SECONDS || 300);
const durationSeconds = Number(process.env.PROPERTY_INTENT_DURATION_SECONDS || 60 * 60 * 24 * 30);
const pollIntervalMs = Number(process.env.PROPERTY_INTENT_POLL_INTERVAL_MS || 15000);
const continuousMode = process.env.PROPERTY_INTENT_CONTINUOUS === 'true';
const ZERO_PRIVATE_KEY =
  '0x0000000000000000000000000000000000000000000000000000000000000000';

if (!rpcUrl) {
  throw new Error('Missing BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL)');
}

if (!operatorKey || operatorKey === ZERO_PRIVATE_KEY) {
  throw new Error(
    'Missing valid PROPERTY_OPERATOR_PRIVATE_KEY (or PLATFORM_OPERATOR_PRIVATE_KEY / PRIVATE_KEY)'
  );
}

if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
  throw new Error('PROPERTY_INTENT_MAX_ATTEMPTS must be a positive integer');
}

if (!Number.isInteger(startDelaySeconds) || startDelaySeconds < 0) {
  throw new Error('PROPERTY_INTENT_START_DELAY_SECONDS must be >= 0');
}

if (!Number.isInteger(durationSeconds) || durationSeconds <= 0) {
  throw new Error('PROPERTY_INTENT_DURATION_SECONDS must be > 0');
}

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error('PROPERTY_INTENT_POLL_INTERVAL_MS must be > 0');
}

const provider = new JsonRpcProvider(rpcUrl);
const baseSigner = new Wallet(operatorKey, provider);
const signer = new NonceManager(baseSigner);
const ADVISORY_LOCK_KEY = 424204001;

const loadArtifact = (artifactPath) => {
  const fullPath = resolve(__dirname, '../../contracts/artifacts/contracts', artifactPath);
  return JSON.parse(readFileSync(fullPath, 'utf8'));
};

const propertyCrowdfundArtifact = loadArtifact('PropertyCrowdfund.sol/PropertyCrowdfund.json');
const equityTokenArtifact = loadArtifact('EquityToken.sol/EquityToken.json');
const profitDistributorArtifact = loadArtifact('ProfitDistributor.sol/ProfitDistributor.json');

const getUsdcAddressForChain = (chainId) => {
  if (chainId === 84532) {
    return (
      process.env.BASE_SEPOLIA_USDC_ADDRESS ||
      process.env.BASE_USDC_ADDRESS ||
      process.env.ETHEREUM_USDC_ADDRESS ||
      ''
    ).toLowerCase();
  }
  if (chainId === 8453) {
    return (process.env.BASE_USDC_ADDRESS || '').toLowerCase();
  }
  if (chainId === 11155111) {
    return (process.env.ETHEREUM_SEPOLIA_USDC_ADDRESS || process.env.ETHEREUM_USDC_ADDRESS || '').toLowerCase();
  }
  if (chainId === 1) {
    return (process.env.ETHEREUM_USDC_ADDRESS || '').toLowerCase();
  }
  return '';
};

const symbolFromPropertyId = (propertyId) => {
  const cleaned = propertyId.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
  if (!cleaned) return 'HSPROP';
  return cleaned.slice(0, 10);
};

const loadPendingIntents = async () =>
  sequelize.query(
    `
    SELECT
      id,
      chain_id AS "chainId",
      property_id AS "propertyId",
      name,
      location,
      description,
      target_usdc_base_units::text AS "targetUsdcBaseUnits",
      LOWER(crowdfund_contract_address) AS "crowdfundAddress",
      LOWER(created_by_address) AS "createdByAddress",
      attempt_count AS "attemptCount"
    FROM property_intents
    WHERE status IN ('pending', 'failed')
      AND attempt_count < :maxAttempts
    ORDER BY created_at ASC
    LIMIT :limit
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { limit: batchSize, maxAttempts },
    }
  );

const acquireWorkerLock = async () => {
  const rows = await sequelize.query(
    'SELECT pg_try_advisory_lock(:key) AS "locked"',
    {
      type: QueryTypes.SELECT,
      replacements: { key: ADVISORY_LOCK_KEY },
    }
  );
  const locked = Array.isArray(rows) && rows[0] && rows[0].locked === true;
  return locked;
};

const releaseWorkerLock = async () => {
  await sequelize.query('SELECT pg_advisory_unlock(:key)', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
};

const markAttempt = async (id) => {
  await sequelize.query(
    `
    UPDATE property_intents
    SET attempt_count = attempt_count + 1,
        last_attempt_at = NOW(),
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id } }
  );
};

const markSubmitted = async (id, txHash, crowdfundAddress) => {
  await sequelize.query(
    `
    UPDATE property_intents
    SET status = 'submitted',
        tx_hash = :txHash,
        crowdfund_contract_address = COALESCE(:crowdfundAddress, crowdfund_contract_address),
        submitted_at = NOW(),
        error_message = NULL,
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id, txHash, crowdfundAddress } }
  );
};

const markConfirmed = async (id) => {
  await sequelize.query(
    `
    UPDATE property_intents
    SET status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id } }
  );
};

const markFailed = async (id, message) => {
  await sequelize.query(
    `
    UPDATE property_intents
    SET status = 'failed',
        error_message = :message,
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id, message: message.slice(0, 500) } }
  );
};

const upsertPropertyRecord = async ({
  propertyId,
  chainId,
  name,
  location,
  description,
  crowdfundAddress,
  equityTokenAddress,
  profitDistributorAddress,
  targetUsdcBaseUnits,
}) => {
  await sequelize.query(
    `
    INSERT INTO properties (
      id,
      property_id,
      chain_id,
      name,
      location,
      description,
      crowdfund_contract_address,
      equity_token_address,
      profit_distributor_address,
      target_usdc_base_units,
      created_at,
      updated_at
    )
    VALUES (
      :id,
      :propertyId,
      :chainId,
      :name,
      :location,
      :description,
      :crowdfundAddress,
      :equityTokenAddress,
      :profitDistributorAddress,
      :targetUsdcBaseUnits,
      NOW(),
      NOW()
    )
    ON CONFLICT (crowdfund_contract_address) DO UPDATE
    SET
      property_id = EXCLUDED.property_id,
      chain_id = EXCLUDED.chain_id,
      name = EXCLUDED.name,
      location = EXCLUDED.location,
      description = EXCLUDED.description,
      equity_token_address = EXCLUDED.equity_token_address,
      profit_distributor_address = EXCLUDED.profit_distributor_address,
      target_usdc_base_units = EXCLUDED.target_usdc_base_units,
      updated_at = NOW()
    `,
    {
      replacements: {
        id: randomUUID(),
        propertyId,
        chainId,
        name,
        location,
        description,
        crowdfundAddress,
        equityTokenAddress,
        profitDistributorAddress,
        targetUsdcBaseUnits,
      },
    }
  );
};

const deployContractsForIntent = async (intent) => {
  const usdcAddress = getUsdcAddressForChain(Number(intent.chainId));
  if (!/^0x[a-f0-9]{40}$/.test(usdcAddress)) {
    throw new Error(
      `Missing USDC address for chain ${intent.chainId}. Set BASE_SEPOLIA_USDC_ADDRESS / BASE_USDC_ADDRESS / ETHEREUM_USDC_ADDRESS.`
    );
  }

  if (!/^0x[a-f0-9]{40}$/.test(intent.createdByAddress || '')) {
    throw new Error('Invalid created_by_address in intent');
  }

  const targetUsdc = BigInt(intent.targetUsdcBaseUnits);
  if (targetUsdc <= 0n) {
    throw new Error('targetUsdcBaseUnits must be > 0');
  }

  const now = Math.floor(Date.now() / 1000);
  const startTimestamp = BigInt(now + startDelaySeconds);
  const endTimestamp = BigInt(now + startDelaySeconds + durationSeconds);
  const totalEquityForSale = targetUsdc * 1_000_000_000_000n; // 6 decimals -> 18 decimals

  const deployOnce = async () => {
    const crowdfundFactory = new ContractFactory(
      propertyCrowdfundArtifact.abi,
      propertyCrowdfundArtifact.bytecode,
      signer
    );
    const crowdfund = await crowdfundFactory.deploy(
      intent.createdByAddress,
      usdcAddress,
      targetUsdc,
      startTimestamp,
      endTimestamp,
      totalEquityForSale,
      intent.propertyId
    );
    const crowdfundReceipt = await crowdfund.deploymentTransaction().wait();
    const crowdfundAddress = (await crowdfund.getAddress()).toLowerCase();

    const tokenName = `${intent.name} Equity`;
    const tokenSymbol = symbolFromPropertyId(intent.propertyId);
    const equityFactory = new ContractFactory(
      equityTokenArtifact.abi,
      equityTokenArtifact.bytecode,
      signer
    );
    const equity = await equityFactory.deploy(
      tokenName,
      tokenSymbol,
      intent.propertyId,
      intent.createdByAddress,
      crowdfundAddress,
      totalEquityForSale
    );
    await equity.deploymentTransaction().wait();
    const equityAddress = (await equity.getAddress()).toLowerCase();

    const profitFactory = new ContractFactory(
      profitDistributorArtifact.abi,
      profitDistributorArtifact.bytecode,
      signer
    );
    const profitDistributor = await profitFactory.deploy(
      intent.createdByAddress,
      usdcAddress,
      equityAddress
    );
    await profitDistributor.deploymentTransaction().wait();
    const profitDistributorAddress = (await profitDistributor.getAddress()).toLowerCase();

    return {
      crowdfundAddress,
      equityAddress,
      profitDistributorAddress,
      txHash: crowdfundReceipt.hash,
    };
  };

  try {
    const deployed = await deployOnce();
    await upsertPropertyRecord({
      propertyId: intent.propertyId,
      chainId: Number(intent.chainId),
      name: intent.name,
      location: intent.location,
      description: intent.description,
      crowdfundAddress: deployed.crowdfundAddress,
      equityTokenAddress: deployed.equityAddress,
      profitDistributorAddress: deployed.profitDistributorAddress,
      targetUsdcBaseUnits: targetUsdc.toString(),
    });
    return deployed;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('nonce has already been used') || message.includes('nonce too low')) {
      // Resync nonce manager and retry once. This commonly occurs when another process
      // submitted txs from the same operator key.
      signer.reset();
      const deployed = await deployOnce();
      await upsertPropertyRecord({
        propertyId: intent.propertyId,
        chainId: Number(intent.chainId),
        name: intent.name,
        location: intent.location,
        description: intent.description,
        crowdfundAddress: deployed.crowdfundAddress,
        equityTokenAddress: deployed.equityAddress,
        profitDistributorAddress: deployed.profitDistributorAddress,
        targetUsdcBaseUnits: targetUsdc.toString(),
      });
      return deployed;
    }
    throw error;
  }
};

const processIntent = async (intent) => {
  await markAttempt(intent.id);

  const deployed = await deployContractsForIntent(intent);
  await markSubmitted(intent.id, deployed.txHash, deployed.crowdfundAddress);
  await markConfirmed(intent.id);
  console.log(
    `confirmed property intent=${intent.id} propertyId=${intent.propertyId} crowdfund=${deployed.crowdfundAddress} equity=${deployed.equityAddress} profitDistributor=${deployed.profitDistributorAddress}`
  );
};

const processOnce = async () => {
  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);

  const intents = await loadPendingIntents();
  if (!Array.isArray(intents) || intents.length === 0) {
    console.log('no retry-eligible property intents');
    return;
  }

  console.log(
    `processing ${intents.length} property intent(s) with maxAttempts=${maxAttempts}`
  );
  for (const intent of intents) {
    try {
      const intentChainId = Number(intent.chainId);
      if (!Number.isInteger(intentChainId) || intentChainId !== connectedChainId) {
        const message = `Intent chain ${intent.chainId} does not match provider chain ${connectedChainId}`;
        await markFailed(intent.id, message);
        console.error(`failed property intent=${intent.id}: ${message}`);
        continue;
      }

      await processIntent(intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await markFailed(intent.id, message);
      const attempts = Number(intent.attemptCount ?? 0) + 1;
      if (attempts >= maxAttempts) {
        console.error(
          `failed property intent=${intent.id}: ${message} (dead-lettered after ${attempts} attempts)`
        );
      } else {
        console.error(
          `failed property intent=${intent.id}: ${message} (attempt ${attempts}/${maxAttempts})`
        );
      }
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const run = async () => {
  const locked = await acquireWorkerLock();
  if (!locked) {
    console.log('property worker lock not acquired (another worker is running). exiting.');
    return;
  }

  if (!continuousMode) {
    try {
      await processOnce();
    } finally {
      await releaseWorkerLock();
    }
    return;
  }

  console.log(`property intent worker started (continuous mode, interval=${pollIntervalMs}ms)`);
  while (true) {
    try {
      await processOnce();
    } catch (error) {
      console.error(
        `[property-worker] loop error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
    await sleep(pollIntervalMs);
  }
};

try {
  await run();
} finally {
  try {
    await releaseWorkerLock();
  } catch (_error) {
    // Ignore unlock errors in shutdown path.
  }
  await sequelize.close();
}
