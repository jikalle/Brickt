import { JsonRpcProvider } from 'ethers';
import { sequelize } from '../db/index.js';
import { Indexer } from './indexer.js';

const primaryRpcUrl = process.env.BASE_SEPOLIA_RPC_URL || '';
const rpcUrl = primaryRpcUrl;
const startBlock = Number(process.env.START_BLOCK ?? 0);
const dryRun = process.env.DRY_RUN === 'true';
const batchSize = Number(process.env.BATCH_SIZE ?? 1000);
const forceStartBlock = process.env.FORCE_START_BLOCK === 'true';
const forcedCrowdfundAddresses = (process.env.CROWDFUND_ADDRESS || '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

async function main(): Promise<void> {
  if (!rpcUrl) {
    throw new Error('BASE_SEPOLIA_RPC_URL is required');
  }

  const provider = new JsonRpcProvider(rpcUrl);
  await sequelize.authenticate();

  const indexer = new Indexer(provider, sequelize, {
    deploymentBlock: startBlock,
    dryRun,
    batchSize,
    forcedCrowdfundAddresses,
    forceStartBlock,
  });

  await indexer.sync();
  await sequelize.close();
}

main().catch((error) => {
  console.error('Indexer failed:', error);
  process.exit(1);
});
