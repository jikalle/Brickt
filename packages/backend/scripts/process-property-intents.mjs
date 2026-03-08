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
const FUNDING_DUST_TOLERANCE_BASE_UNITS = 1n; // 0.000001 USDC (6 decimals)
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
const operatorAddress = baseSigner.address.toLowerCase();
const ADVISORY_LOCK_KEY = 424204001;
const OFFICIAL_BASE_SEPOLIA_USDC = '0x036cbd53842c5426634e7929541ec2318f3dcf7e';

const loadArtifact = (artifactPath) => {
  const fullPath = resolve(__dirname, '../../contracts/artifacts/contracts', artifactPath);
  return JSON.parse(readFileSync(fullPath, 'utf8'));
};

const propertyCrowdfundArtifact = loadArtifact('PropertyCrowdfund.sol/PropertyCrowdfund.json');
const equityTokenArtifact = loadArtifact('EquityToken.sol/EquityToken.json');
const profitDistributorArtifact = loadArtifact('ProfitDistributor.sol/ProfitDistributor.json');

const getUsdcAddressForChain = (chainId) => {
  if (chainId === 84532) {
    // Enforce official Base Sepolia USDC for all newly deployed campaigns.
    return OFFICIAL_BASE_SEPOLIA_USDC;
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

const normalizeScenarioMultiplier = (value, fallback) => {
  if (value === null || value === undefined) {
    return fallback;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0 || numeric > 100000) {
    return fallback;
  }
  return Math.round(numeric);
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
      best_for AS "bestFor",
      image_url AS "imageUrl",
      gallery_image_urls AS "imageUrls",
      youtube_embed_url AS "youtubeEmbedUrl",
      latitude::double precision AS "latitude",
      longitude::double precision AS "longitude",
      target_usdc_base_units::text AS "targetUsdcBaseUnits",
      estimated_sell_usdc_base_units::text AS "estimatedSellUsdcBaseUnits",
      conservative_sell_usdc_base_units::text AS "conservativeSellUsdcBaseUnits",
      base_sell_usdc_base_units::text AS "baseSellUsdcBaseUnits",
      optimistic_sell_usdc_base_units::text AS "optimisticSellUsdcBaseUnits",
      conservative_multiplier_bps AS "conservativeMultiplierBps",
      base_multiplier_bps AS "baseMultiplierBps",
      optimistic_multiplier_bps AS "optimisticMultiplierBps",
      start_time AS "startTime",
      end_time AS "endTime",
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
  bestFor,
  imageUrl,
  youtubeEmbedUrl,
  latitude,
  longitude,
  crowdfundAddress,
  equityTokenAddress,
  profitDistributorAddress,
  targetUsdcBaseUnits,
  estimatedSellUsdcBaseUnits,
  conservativeSellUsdcBaseUnits,
  baseSellUsdcBaseUnits,
  optimisticSellUsdcBaseUnits,
  conservativeMultiplierBps,
  baseMultiplierBps,
  optimisticMultiplierBps,
}) => {
  const normalizedConservativeMultiplierBps = normalizeScenarioMultiplier(
    conservativeMultiplierBps,
    8500
  );
  const normalizedBaseMultiplierBps = normalizeScenarioMultiplier(baseMultiplierBps, 10000);
  const normalizedOptimisticMultiplierBps = normalizeScenarioMultiplier(
    optimisticMultiplierBps,
    12500
  );
  const [rows] = await sequelize.query(
    `
    INSERT INTO properties (
      id,
      property_id,
      chain_id,
      name,
      location,
      description,
      best_for,
      image_url,
      youtube_embed_url,
      latitude,
      longitude,
      crowdfund_contract_address,
      equity_token_address,
      profit_distributor_address,
      target_usdc_base_units,
      estimated_sell_usdc_base_units,
      conservative_sell_usdc_base_units,
      base_sell_usdc_base_units,
      optimistic_sell_usdc_base_units,
      conservative_multiplier_bps,
      base_multiplier_bps,
      optimistic_multiplier_bps,
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
      :bestFor,
      :imageUrl,
      :youtubeEmbedUrl,
      :latitude,
      :longitude,
      :crowdfundAddress,
      :equityTokenAddress,
      :profitDistributorAddress,
      :targetUsdcBaseUnits,
      :estimatedSellUsdcBaseUnits,
      :conservativeSellUsdcBaseUnits,
      :baseSellUsdcBaseUnits,
      :optimisticSellUsdcBaseUnits,
      :conservativeMultiplierBps,
      :baseMultiplierBps,
      :optimisticMultiplierBps,
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
      best_for = EXCLUDED.best_for,
      image_url = EXCLUDED.image_url,
      youtube_embed_url = EXCLUDED.youtube_embed_url,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      equity_token_address = EXCLUDED.equity_token_address,
      profit_distributor_address = EXCLUDED.profit_distributor_address,
      target_usdc_base_units = EXCLUDED.target_usdc_base_units,
      estimated_sell_usdc_base_units = EXCLUDED.estimated_sell_usdc_base_units,
      conservative_sell_usdc_base_units = EXCLUDED.conservative_sell_usdc_base_units,
      base_sell_usdc_base_units = EXCLUDED.base_sell_usdc_base_units,
      optimistic_sell_usdc_base_units = EXCLUDED.optimistic_sell_usdc_base_units,
      conservative_multiplier_bps = EXCLUDED.conservative_multiplier_bps,
      base_multiplier_bps = EXCLUDED.base_multiplier_bps,
      optimistic_multiplier_bps = EXCLUDED.optimistic_multiplier_bps,
      updated_at = NOW()
    RETURNING id AS "propertyUuid"
    `,
    {
      replacements: {
        id: randomUUID(),
        propertyId,
        chainId,
        name,
        location,
        description,
        bestFor,
        imageUrl,
        youtubeEmbedUrl,
        latitude: latitude ?? null,
        longitude: longitude ?? null,
        crowdfundAddress,
        equityTokenAddress,
        profitDistributorAddress,
        targetUsdcBaseUnits,
        estimatedSellUsdcBaseUnits,
        conservativeSellUsdcBaseUnits,
        baseSellUsdcBaseUnits,
        optimisticSellUsdcBaseUnits,
        conservativeMultiplierBps: normalizedConservativeMultiplierBps,
        baseMultiplierBps: normalizedBaseMultiplierBps,
        optimisticMultiplierBps: normalizedOptimisticMultiplierBps,
      },
    }
  );
  return Array.isArray(rows) ? rows[0] : null;
};

const syncPropertyImages = async (propertyUuid, imageUrls) => {
  if (!propertyUuid) {
    return;
  }
  await sequelize.query(
    `
    DELETE FROM property_images
    WHERE property_id = :propertyUuid
    `,
    { replacements: { propertyUuid } }
  );

  if (!Array.isArray(imageUrls) || imageUrls.length === 0) {
    return;
  }

  for (let index = 0; index < imageUrls.length; index += 1) {
    const imageUrl = imageUrls[index];
    if (!imageUrl || typeof imageUrl !== 'string') continue;
    await sequelize.query(
      `
      INSERT INTO property_images (
        id,
        property_id,
        image_url,
        sort_order,
        created_at
      )
      VALUES (
        :id,
        :propertyUuid,
        :imageUrl,
        :sortOrder,
        NOW()
      )
      `,
      {
        replacements: {
          id: randomUUID(),
          propertyUuid,
          imageUrl,
          sortOrder: index,
        },
      }
    );
  }
};

const deployContractsForIntent = async (intent) => {
  const usdcAddress = getUsdcAddressForChain(Number(intent.chainId));
  if (!/^0x[a-f0-9]{40}$/.test(usdcAddress)) {
    throw new Error(
      `Missing USDC address for chain ${intent.chainId}. Set BASE_SEPOLIA_USDC_ADDRESS / BASE_USDC_ADDRESS / ETHEREUM_USDC_ADDRESS.`
    );
  }

  if (Number(intent.chainId) === 84532 && usdcAddress !== OFFICIAL_BASE_SEPOLIA_USDC) {
    throw new Error(
      `Invalid Base Sepolia USDC address ${usdcAddress}. Expected official ${OFFICIAL_BASE_SEPOLIA_USDC}.`
    );
  }

  if (!/^0x[a-f0-9]{40}$/.test(intent.createdByAddress || '')) {
    throw new Error('Invalid created_by_address in intent');
  }

  const targetUsdc = BigInt(intent.targetUsdcBaseUnits);
  if (targetUsdc <= 0n) {
    throw new Error('targetUsdcBaseUnits must be > 0');
  }
  // Avoid edge-case failures where a campaign misses target by dust (1 base unit).
  const effectiveTargetUsdc =
    targetUsdc > FUNDING_DUST_TOLERANCE_BASE_UNITS
      ? targetUsdc - FUNDING_DUST_TOLERANCE_BASE_UNITS
      : targetUsdc;
  const estimatedSellUsdc =
    intent.estimatedSellUsdcBaseUnits && `${intent.estimatedSellUsdcBaseUnits}`.trim() !== ''
      ? BigInt(intent.estimatedSellUsdcBaseUnits)
      : null;
  if (estimatedSellUsdc !== null && estimatedSellUsdc <= 0n) {
    throw new Error('estimatedSellUsdcBaseUnits must be > 0 when provided');
  }
  const conservativeSellUsdc =
    intent.conservativeSellUsdcBaseUnits && `${intent.conservativeSellUsdcBaseUnits}`.trim() !== ''
      ? BigInt(intent.conservativeSellUsdcBaseUnits)
      : null;
  const baseSellUsdc =
    intent.baseSellUsdcBaseUnits && `${intent.baseSellUsdcBaseUnits}`.trim() !== ''
      ? BigInt(intent.baseSellUsdcBaseUnits)
      : null;
  const optimisticSellUsdc =
    intent.optimisticSellUsdcBaseUnits && `${intent.optimisticSellUsdcBaseUnits}`.trim() !== ''
      ? BigInt(intent.optimisticSellUsdcBaseUnits)
      : null;
  if (conservativeSellUsdc !== null && conservativeSellUsdc <= 0n) {
    throw new Error('conservativeSellUsdcBaseUnits must be > 0 when provided');
  }
  if (baseSellUsdc !== null && baseSellUsdc <= 0n) {
    throw new Error('baseSellUsdcBaseUnits must be > 0 when provided');
  }
  if (optimisticSellUsdc !== null && optimisticSellUsdc <= 0n) {
    throw new Error('optimisticSellUsdcBaseUnits must be > 0 when provided');
  }

  const now = Math.floor(Date.now() / 1000);
  const parsedStartTime = intent.startTime ? Math.floor(new Date(intent.startTime).getTime() / 1000) : null;
  const parsedEndTime = intent.endTime ? Math.floor(new Date(intent.endTime).getTime() / 1000) : null;
  const startTimestamp = BigInt(parsedStartTime ?? now + startDelaySeconds);
  const endTimestamp = BigInt(parsedEndTime ?? now + startDelaySeconds + durationSeconds);
  if (endTimestamp <= startTimestamp) {
    throw new Error('Invalid campaign schedule: endTime must be after startTime');
  }
  const totalEquityForSale = effectiveTargetUsdc * 1_000_000_000_000n; // 6 decimals -> 18 decimals

  const deployOnce = async () => {
    const crowdfundFactory = new ContractFactory(
      propertyCrowdfundArtifact.abi,
      propertyCrowdfundArtifact.bytecode,
      signer
    );
    const crowdfund = await crowdfundFactory.deploy(
      intent.createdByAddress,
      usdcAddress,
      effectiveTargetUsdc,
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
    // Profit deposits are executed by the operator worker, so the
    // ProfitDistributor owner must be the operator signer.
    const profitDistributor = await profitFactory.deploy(
      operatorAddress,
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
    const upserted = await upsertPropertyRecord({
      propertyId: intent.propertyId,
      chainId: Number(intent.chainId),
      name: intent.name,
      location: intent.location,
      description: intent.description,
      bestFor: intent.bestFor ?? null,
      imageUrl: intent.imageUrl ?? null,
      youtubeEmbedUrl: intent.youtubeEmbedUrl ?? null,
      latitude:
        Number.isFinite(Number(intent.latitude)) ? Number(intent.latitude) : null,
      longitude:
        Number.isFinite(Number(intent.longitude)) ? Number(intent.longitude) : null,
      crowdfundAddress: deployed.crowdfundAddress,
      equityTokenAddress: deployed.equityAddress,
      profitDistributorAddress: deployed.profitDistributorAddress,
      targetUsdcBaseUnits: targetUsdc.toString(),
      estimatedSellUsdcBaseUnits: estimatedSellUsdc ? estimatedSellUsdc.toString() : null,
      conservativeSellUsdcBaseUnits: conservativeSellUsdc ? conservativeSellUsdc.toString() : null,
      baseSellUsdcBaseUnits: baseSellUsdc ? baseSellUsdc.toString() : null,
      optimisticSellUsdcBaseUnits: optimisticSellUsdc ? optimisticSellUsdc.toString() : null,
      conservativeMultiplierBps:
        Number.isInteger(Number(intent.conservativeMultiplierBps))
          ? Number(intent.conservativeMultiplierBps)
          : null,
      baseMultiplierBps:
        Number.isInteger(Number(intent.baseMultiplierBps)) ? Number(intent.baseMultiplierBps) : null,
      optimisticMultiplierBps:
        Number.isInteger(Number(intent.optimisticMultiplierBps))
          ? Number(intent.optimisticMultiplierBps)
          : null,
    });
    await syncPropertyImages(
      upserted?.propertyUuid,
      Array.isArray(intent.imageUrls) ? intent.imageUrls : []
    );
    return deployed;
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('nonce has already been used') || message.includes('nonce too low')) {
      // Resync nonce manager and retry once. This commonly occurs when another process
      // submitted txs from the same operator key.
      signer.reset();
      const deployed = await deployOnce();
      const upserted = await upsertPropertyRecord({
        propertyId: intent.propertyId,
        chainId: Number(intent.chainId),
        name: intent.name,
        location: intent.location,
        description: intent.description,
        bestFor: intent.bestFor ?? null,
        imageUrl: intent.imageUrl ?? null,
        youtubeEmbedUrl: intent.youtubeEmbedUrl ?? null,
        latitude:
          Number.isFinite(Number(intent.latitude)) ? Number(intent.latitude) : null,
        longitude:
          Number.isFinite(Number(intent.longitude)) ? Number(intent.longitude) : null,
        crowdfundAddress: deployed.crowdfundAddress,
        equityTokenAddress: deployed.equityAddress,
        profitDistributorAddress: deployed.profitDistributorAddress,
        targetUsdcBaseUnits: targetUsdc.toString(),
        estimatedSellUsdcBaseUnits: estimatedSellUsdc ? estimatedSellUsdc.toString() : null,
        conservativeSellUsdcBaseUnits: conservativeSellUsdc ? conservativeSellUsdc.toString() : null,
        baseSellUsdcBaseUnits: baseSellUsdc ? baseSellUsdc.toString() : null,
        optimisticSellUsdcBaseUnits: optimisticSellUsdc ? optimisticSellUsdc.toString() : null,
        conservativeMultiplierBps:
          Number.isInteger(Number(intent.conservativeMultiplierBps))
            ? Number(intent.conservativeMultiplierBps)
            : null,
        baseMultiplierBps:
          Number.isInteger(Number(intent.baseMultiplierBps))
            ? Number(intent.baseMultiplierBps)
            : null,
        optimisticMultiplierBps:
          Number.isInteger(Number(intent.optimisticMultiplierBps))
            ? Number(intent.optimisticMultiplierBps)
            : null,
      });
      await syncPropertyImages(
        upserted?.propertyUuid,
        Array.isArray(intent.imageUrls) ? intent.imageUrls : []
      );
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
    `processing ${intents.length} property intent(s) with maxAttempts=${maxAttempts} rpc=${rpcUrl}`
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
