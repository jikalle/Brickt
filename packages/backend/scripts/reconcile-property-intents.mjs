import { JsonRpcProvider } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const batchSize = Number(process.env.PROPERTY_RECONCILE_BATCH_SIZE || 50);

if (!rpcUrl) {
  throw new Error('Missing BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL)');
}

if (!Number.isInteger(batchSize) || batchSize <= 0) {
  throw new Error('PROPERTY_RECONCILE_BATCH_SIZE must be a positive integer');
}

const provider = new JsonRpcProvider(rpcUrl);

const loadSubmittedIntents = async () =>
  sequelize.query(
    `
    SELECT
      id,
      chain_id AS "chainId",
      tx_hash AS "txHash"
    FROM property_intents
    WHERE status = 'submitted'
      AND tx_hash IS NOT NULL
    ORDER BY submitted_at ASC NULLS LAST
    LIMIT :limit
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { limit: batchSize },
    }
  );

const markConfirmed = async (id) => {
  await sequelize.query(
    `
    UPDATE property_intents
    SET status = 'confirmed',
        confirmed_at = COALESCE(confirmed_at, NOW()),
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
    {
      replacements: {
        id,
        message: message.slice(0, 500),
      },
    }
  );
};

const reconcileIntent = async (intent) => {
  const receipt = await provider.getTransactionReceipt(intent.txHash);
  if (!receipt) {
    console.log(`pending property intent=${intent.id} tx=${intent.txHash}`);
    return;
  }

  if (Number(receipt.status) === 1) {
    await markConfirmed(intent.id);
    console.log(`confirmed property intent=${intent.id} tx=${intent.txHash}`);
    return;
  }

  await markFailed(intent.id, 'Transaction reverted during reconciliation');
  console.error(
    `failed property intent=${intent.id} tx=${intent.txHash} (receipt status ${receipt.status})`
  );
};

const run = async () => {
  const network = await provider.getNetwork();
  const connectedChainId = Number(network.chainId);

  const intents = await loadSubmittedIntents();
  if (!Array.isArray(intents) || intents.length === 0) {
    console.log('no submitted property intents to reconcile');
    return;
  }

  console.log(`reconciling ${intents.length} submitted property intent(s)`);
  for (const intent of intents) {
    try {
      const intentChainId = Number(intent.chainId);
      if (!Number.isInteger(intentChainId) || intentChainId !== connectedChainId) {
        const message = `Intent chain ${intent.chainId} does not match provider chain ${connectedChainId}`;
        await markFailed(intent.id, message);
        console.error(`failed property intent=${intent.id}: ${message}`);
        continue;
      }

      await reconcileIntent(intent);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown reconciliation error';
      await markFailed(intent.id, message);
      console.error(`failed property intent=${intent.id}: ${message}`);
    }
  }
};

try {
  await run();
} finally {
  await sequelize.close();
}

