import dotenv from 'dotenv';
import { JsonRpcProvider } from 'ethers';

dotenv.config();
process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const usage = () => {
  console.log(`Usage:
  pnpm --filter @homeshare/backend indexer:sync:tx -- <txHash> [windowBlocks] [batchSize] [crowdfundAddress]

Examples:
  pnpm --filter @homeshare/backend indexer:sync:tx -- 0xabc...def
  pnpm --filter @homeshare/backend indexer:sync:tx -- 0xabc...def 200 500
  pnpm --filter @homeshare/backend indexer:sync:tx -- 0xabc...def 200 500 0x1234...abcd
`);
};

const normalizeAddress = (value) => {
  if (!value) {
    return null;
  }
  const v = value.toLowerCase();
  if (!/^0x[a-f0-9]{40}$/.test(v)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return v;
};

const parsePositiveInt = (value, fallback) => {
  if (!value) {
    return fallback;
  }
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`Expected a positive integer, got: ${value}`);
  }
  return n;
};

const rawArgs = process.argv.slice(2);
const args = rawArgs[0] === '--' ? rawArgs.slice(1) : rawArgs;
const [txHash, windowRaw, batchRaw, crowdfundRaw] = args;

if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
  usage();
  process.exit(1);
}

const windowBlocks = parsePositiveInt(windowRaw, 2000);
const batchSize = parsePositiveInt(batchRaw, 1000);
const explicitCrowdfund = normalizeAddress(crowdfundRaw ?? null);

const rpcUrl = process.env.BASE_SEPOLIA_RPC_URL || '';
if (!rpcUrl) {
  throw new Error('BASE_SEPOLIA_RPC_URL is required');
}

const provider = new JsonRpcProvider(rpcUrl);
const receipt = await provider.getTransactionReceipt(txHash);
if (!receipt) {
  throw new Error(`Transaction receipt not found for tx=${txHash}`);
}

const blockNumber = Number(receipt.blockNumber);
const startBlock = Math.max(0, blockNumber - windowBlocks);
const receiptTo = receipt.to ? normalizeAddress(receipt.to) : null;
const crowdfundAddress = explicitCrowdfund ?? receiptTo;

console.log(
  `[indexer:sync:tx] tx=${txHash} block=${blockNumber} start=${startBlock} window=${windowBlocks} batch=${batchSize}`
);
if (crowdfundAddress) {
  console.log(`[indexer:sync:tx] scoped crowdfund=${crowdfundAddress}`);
} else {
  console.log('[indexer:sync:tx] no crowdfund scope (receipt.to missing)');
}

const { sequelize } = await import('../dist/db/index.js');
const { Indexer } = await import('../dist/indexer/indexer.js');

try {
  await sequelize.authenticate();
  const indexer = new Indexer(provider, sequelize, {
    deploymentBlock: startBlock,
    batchSize,
    forceStartBlock: true,
    forcedCrowdfundAddresses: crowdfundAddress ? [crowdfundAddress] : [],
  });
  await indexer.sync();
} finally {
  await sequelize.close();
}
