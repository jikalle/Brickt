import { spawn } from 'child_process';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL || '';
const batchSize = Number(process.env.INDEXER_BATCH_SIZE || process.env.BATCH_SIZE || 1000);
const startBlock = Number(process.env.INDEXER_START_BLOCK || process.env.START_BLOCK || 0);
const pollIntervalMs = Number(process.env.INDEXER_POLL_INTERVAL_MS || 15000);
const continuousMode = process.env.INDEXER_CONTINUOUS === 'true';
const forceStartBlock =
  process.env.INDEXER_FORCE_START_BLOCK === 'true' || process.env.FORCE_START_BLOCK === 'true';
const dryRun = process.env.DRY_RUN === 'true';
const forcedCrowdfundAddresses = (process.env.CROWDFUND_ADDRESS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const ADVISORY_LOCK_KEY = 424204005;

if (!rpcUrl) {
  throw new Error('Missing BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL)');
}

if (!Number.isInteger(batchSize) || batchSize <= 0) {
  throw new Error('INDEXER_BATCH_SIZE must be > 0');
}

if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
  throw new Error('INDEXER_POLL_INTERVAL_MS must be > 0');
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const runIndexerSyncOnce = () =>
  new Promise((resolve, reject) => {
    const child = spawn('node', ['--import', 'tsx', 'src/indexer/run.ts'], {
      stdio: 'inherit',
      env: {
        ...process.env,
        BASE_SEPOLIA_RPC_URL: rpcUrl,
        START_BLOCK: String(startBlock),
        BATCH_SIZE: String(batchSize),
        FORCE_START_BLOCK: forceStartBlock ? 'true' : 'false',
        DRY_RUN: dryRun ? 'true' : 'false',
        CROWDFUND_ADDRESS: forcedCrowdfundAddresses.join(','),
      },
    });

    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }
      reject(
        new Error(
          `indexer sync exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`
        )
      );
    });
  });

const processOnce = async () => {
  await runIndexerSyncOnce();
};

const run = async () => {
  const locked = await acquireWorkerLock();
  if (!locked) {
    console.log('indexer worker lock not acquired (another worker is running). exiting.');
    return;
  }

  if (!continuousMode) {
    try {
      await processOnce();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(
        `[indexer-worker] run failed. Check RPC reachability and BASE_*_RPC_URL settings. rpc=${rpcUrl} error=${message}`
      );
      process.exitCode = 1;
    } finally {
      await releaseWorkerLock();
      await sequelize.close();
    }
    return;
  }

  console.log(`indexer worker started (continuous mode, interval=${pollIntervalMs}ms)`);
  try {
    while (true) {
      try {
        await processOnce();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(
          `[indexer-worker] cycle failed. Check RPC reachability and BASE_*_RPC_URL settings. rpc=${rpcUrl} error=${message}`
        );
      }
      await sleep(pollIntervalMs);
    }
  } finally {
    await releaseWorkerLock();
    await sequelize.close();
  }
};

await run();
