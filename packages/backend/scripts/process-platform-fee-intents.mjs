import { Interface, JsonRpcProvider, Wallet, ZeroAddress } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const operatorKey = process.env.PLATFORM_OPERATOR_PRIVATE_KEY || '';
const batchSize = Number(process.env.PLATFORM_FEE_INTENT_BATCH_SIZE || 10);
const maxAttempts = Number(process.env.PLATFORM_FEE_INTENT_MAX_ATTEMPTS || 3);
const ZERO_PRIVATE_KEY = '0x0000000000000000000000000000000000000000000000000000000000000000';

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
const signer = new Wallet(operatorKey, provider);
const crowdfundInterface = new Interface([
  'function setPlatformFee(uint16 feeBps, address recipient)',
]);

if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
  throw new Error('PLATFORM_FEE_INTENT_MAX_ATTEMPTS must be a positive integer');
}

const loadPendingIntents = async () =>
  sequelize.query(
    `
    SELECT
      id,
      chain_id AS "chainId",
      LOWER(campaign_address) AS "campaignAddress",
      platform_fee_bps AS "platformFeeBps",
      LOWER(platform_fee_recipient) AS "platformFeeRecipient",
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

  const data = crowdfundInterface.encodeFunctionData('setPlatformFee', [
    intent.platformFeeBps,
    recipient,
  ]);

  const tx = await signer.sendTransaction({
    to: intent.campaignAddress,
    data,
  });

  await markSubmitted(intent.id, tx.hash);
  const receipt = await tx.wait();
  if (!receipt || Number(receipt.status) !== 1) {
    throw new Error('Transaction reverted');
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
    `processing ${intents.length} platform fee intent(s) with maxAttempts=${maxAttempts}`
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

try {
  await run();
} finally {
  await sequelize.close();
}
