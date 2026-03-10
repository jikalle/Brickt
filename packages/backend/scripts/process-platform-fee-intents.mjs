import { Contract, Interface, JsonRpcProvider, NonceManager, Wallet, ZeroAddress } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');
const { upsertOnchainActivity } = await import('../dist/lib/onchainActivity.js');

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const operatorKey = process.env.PLATFORM_OPERATOR_PRIVATE_KEY || '';
const batchSize = Number(process.env.PLATFORM_FEE_INTENT_BATCH_SIZE || 10);
const maxAttempts = Number(process.env.PLATFORM_FEE_INTENT_MAX_ATTEMPTS || 3);
const pollIntervalMs = Number(process.env.PLATFORM_FEE_INTENT_POLL_INTERVAL_MS || 15000);
const continuousMode = process.env.PLATFORM_FEE_INTENT_CONTINUOUS === 'true';
const ZERO_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000000';
const ADVISORY_LOCK_KEY = 424204007;

if (!rpcUrl) {
  throw new Error('Missing BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL)');
}

if (!operatorKey) {
  throw new Error('Missing PLATFORM_OPERATOR_PRIVATE_KEY');
}

if (operatorKey === ZERO_PRIVATE_KEY) {
  throw new Error('PLATFORM_OPERATOR_PRIVATE_KEY cannot be zero placeholder value');
}

const provider = new JsonRpcProvider(rpcUrl);
const baseSigner = new Wallet(operatorKey, provider);
const signer = new NonceManager(baseSigner);
const crowdfundInterface = new Interface([
  'function setPlatformFee(uint16 feeBps, address recipient)',
  'function usdcToken() view returns (address)',
]);
const erc20Abi = [
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address account) view returns (uint256)',
];

if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
  throw new Error('PLATFORM_FEE_INTENT_MAX_ATTEMPTS must be a positive integer');
}

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error('PLATFORM_FEE_INTENT_POLL_INTERVAL_MS must be > 0');
}

const acquireWorkerLock = async () => {
  const rows = await sequelize.query('SELECT pg_try_advisory_lock(:key) AS "locked"', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
  return Array.isArray(rows) && rows[0] && rows[0].locked === true;
};

const releaseWorkerLock = async () => {
  await sequelize.query('SELECT pg_advisory_unlock(:key)', {
    type: QueryTypes.SELECT,
    replacements: { key: ADVISORY_LOCK_KEY },
  });
};

const loadPendingIntents = async () =>
  sequelize.query(
    `
    SELECT
      id,
      chain_id AS "chainId",
      LOWER(campaign_address) AS "campaignAddress",
      platform_fee_bps AS "platformFeeBps",
      LOWER(platform_fee_recipient) AS "platformFeeRecipient",
      usdc_amount_base_units::text AS "usdcAmountBaseUnits",
      attempt_count AS "attemptCount"
    FROM platform_fee_intents
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

const markAttempt = async (id) => {
  await sequelize.query(
    `
    UPDATE platform_fee_intents
    SET attempt_count = attempt_count + 1,
        last_attempt_at = NOW(),
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id } }
  );
};

const markSubmitted = async (id, txHash) => {
  await sequelize.query(
    `
    UPDATE platform_fee_intents
    SET status = 'submitted',
        tx_hash = :txHash,
        submitted_at = NOW(),
        error_message = NULL,
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id, txHash } }
  );
};

const markConfirmed = async (id) => {
  await sequelize.query(
    `
    UPDATE platform_fee_intents
    SET status = 'confirmed',
        confirmed_at = NOW(),
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id } }
  );
};

const recordPlatformFeeActivity = async (id, txHash, activityType, status) => {
  const rows = await sequelize.query(
    `
    SELECT
      chain_id AS "chainId",
      LOWER(campaign_address) AS "campaignAddress",
      created_by_address AS "createdByAddress"
    FROM platform_fee_intents
    WHERE id = :id
    LIMIT 1
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { id },
    }
  );
  const intent = Array.isArray(rows) ? rows[0] : null;
  if (!intent) {
    return;
  }
  await upsertOnchainActivity(sequelize, {
    chainId: Number(intent.chainId),
    txHash,
    activityType,
    status,
    actorRole: 'worker',
    actorAddress: intent.createdByAddress?.toLowerCase?.() ?? null,
    campaignAddress: intent.campaignAddress,
    intentType: 'platformFee',
    intentId: id,
  });
};

const markFailed = async (id, message) => {
  await sequelize.query(
    `
    UPDATE platform_fee_intents
    SET status = 'failed',
        error_message = :message,
        updated_at = NOW()
    WHERE id = :id
    `,
    { replacements: { id, message: message.slice(0, 500) } }
  );
};

const processIntent = async (intent) => {
  await markAttempt(intent.id);

  const recipient =
    intent.platformFeeBps > 0
      ? intent.platformFeeRecipient || ZeroAddress
      : intent.platformFeeRecipient || ZeroAddress;
  const transferAmount = BigInt(intent.usdcAmountBaseUnits ?? '0');

  const data = crowdfundInterface.encodeFunctionData('setPlatformFee', [
    intent.platformFeeBps,
    recipient,
  ]);

  let tx;
  try {
    tx = await signer.sendTransaction({
      to: intent.campaignAddress,
      data,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('nonce has already been used') || message.includes('nonce too low')) {
      signer.reset();
      tx = await signer.sendTransaction({
        to: intent.campaignAddress,
        data,
      });
    } else {
      throw error;
    }
  }

  await markSubmitted(intent.id, tx.hash);
  await recordPlatformFeeActivity(intent.id, tx.hash, 'platform-fee-configure', 'submitted');
  const receipt = await tx.wait();
  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error('setPlatformFee transaction reverted');
  }
  await recordPlatformFeeActivity(intent.id, tx.hash, 'platform-fee-configure', 'confirmed');

  if (transferAmount > 0n) {
    if (!recipient || recipient === ZeroAddress) {
      throw new Error('platform fee transfer requires non-zero recipient');
    }

    const usdcTokenData = crowdfundInterface.encodeFunctionData('usdcToken', []);
    const usdcTokenRaw = await provider.call({
      to: intent.campaignAddress,
      data: usdcTokenData,
    });
    const [usdcTokenAddress] = crowdfundInterface.decodeFunctionResult('usdcToken', usdcTokenRaw);
    const usdc = new Contract(String(usdcTokenAddress).toLowerCase(), erc20Abi, signer);
    const operatorBalance = await usdc.balanceOf(baseSigner.address);
    if (operatorBalance < transferAmount) {
      throw new Error(
        `insufficient operator USDC balance for platform fee transfer: required=${transferAmount.toString()} balance=${operatorBalance.toString()}`
      );
    }

    let transferTx;
    try {
      transferTx = await usdc.transfer(recipient, transferAmount);
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
      if (message.includes('nonce has already been used') || message.includes('nonce too low')) {
        signer.reset();
        transferTx = await usdc.transfer(recipient, transferAmount);
      } else {
        throw error;
      }
    }
    await markSubmitted(intent.id, transferTx.hash);
    await recordPlatformFeeActivity(intent.id, transferTx.hash, 'platform-fee-transfer', 'submitted');
    const transferReceipt = await transferTx.wait();
    if (!transferReceipt || Number(transferReceipt.status) !== 1) {
      throw new Error('platform fee transfer reverted');
    }
    await recordPlatformFeeActivity(intent.id, transferTx.hash, 'platform-fee-transfer', 'confirmed');

    await markConfirmed(intent.id);
    console.log(
      `confirmed intent=${intent.id} campaign=${intent.campaignAddress} setPlatformFeeTx=${tx.hash} transferTx=${transferTx.hash} recipient=${recipient} amount=${transferAmount.toString()}`
    );
    return;
  }

  await markConfirmed(intent.id);
  console.log(
    `confirmed intent=${intent.id} campaign=${intent.campaignAddress} tx=${tx.hash}`
  );
};

const run = async () => {
  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);

  const intents = await loadPendingIntents();
  if (!Array.isArray(intents) || intents.length === 0) {
    console.log('no retry-eligible platform fee intents');
    return;
  }

  console.log(
    `processing ${intents.length} platform fee intent(s) with maxAttempts=${maxAttempts} rpc=${rpcUrl}`
  );
  for (const intent of intents) {
    try {
      const intentChainId = Number(intent.chainId);
      if (!Number.isInteger(intentChainId) || intentChainId !== connectedChainId) {
        const message = `Intent chain ${intent.chainId} does not match provider chain ${connectedChainId}`;
        await markFailed(intent.id, message);
        console.error(`failed intent=${intent.id}: ${message}`);
        continue;
      }

      await processIntent(intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      await markFailed(intent.id, message);
      const attempts = Number(intent.attemptCount ?? 0) + 1;
      if (attempts >= maxAttempts) {
        console.error(
          `failed intent=${intent.id}: ${message} (dead-lettered after ${attempts} attempts)`
        );
      } else {
        console.error(
          `failed intent=${intent.id}: ${message} (attempt ${attempts}/${maxAttempts})`
        );
      }
    }
  }
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

try {
  const locked = await acquireWorkerLock();
  if (!locked) {
    console.log('platform fee worker lock not acquired (another worker is running). exiting.');
    process.exit(0);
  }

  if (!continuousMode) {
    await run();
  } else {
    console.log(`platform fee intent worker started (continuous mode, interval=${pollIntervalMs}ms)`);
    while (true) {
      try {
        await run();
      } catch (error) {
        console.error(
          `[platform-fee-worker] loop error: ${error instanceof Error ? error.message : String(error)}`
        );
      }
      await sleep(pollIntervalMs);
    }
  }
} finally {
  try {
    await releaseWorkerLock();
  } catch (_error) {
    // Ignore unlock errors during shutdown.
  }
  await sequelize.close();
}
