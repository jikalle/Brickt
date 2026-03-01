import { JsonRpcProvider } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const staleMinutes = Number(process.env.OBS_SUBMITTED_STALE_MINUTES || 30);
const rpcUrl =
  process.env.RPC_URL ||
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.BASE_MAINNET_RPC_URL ||
  '';

const summarizeStatuses = (rows) => {
  const out = {
    pending: 0,
    submitted: 0,
    confirmed: 0,
    failed: 0,
  };
  for (const row of rows) {
    const status = String(row.status || '').toLowerCase();
    const count = Number(row.count || 0);
    if (status in out) {
      out[status] = count;
    }
  }
  return out;
};

const getIntentStatusCounts = async (table) => {
  const rows = await sequelize.query(
    `
    SELECT status, COUNT(*)::int AS count
    FROM ${table}
    GROUP BY status
    `,
    { type: QueryTypes.SELECT }
  );
  return summarizeStatuses(rows);
};

const getStaleSubmitted = async (table) => {
  const rows = await sequelize.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ${table}
    WHERE status = 'submitted'
      AND submitted_at IS NOT NULL
      AND submitted_at < NOW() - make_interval(mins => :minutes)
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { minutes: staleMinutes },
    }
  );
  return Array.isArray(rows) && rows[0] ? Number(rows[0].count || 0) : 0;
};

const getIndexerState = async () =>
  sequelize.query(
    `
    SELECT chain_id AS "chainId", last_block AS "lastBlock"
    FROM indexer_state
    ORDER BY chain_id ASC
    `,
    { type: QueryTypes.SELECT }
  );

const snapshot = {
  timestamp: new Date().toISOString(),
  rpc: {
    enabled: Boolean(rpcUrl),
    latestBlock: null,
    latencyMs: null,
    error: null,
  },
  indexer: {
    byChain: [],
  },
  intents: {},
};

try {
  const intentTables = [
    'property_intents',
    'profit_distribution_intents',
    'platform_fee_intents',
  ];

  for (const table of intentTables) {
    const [statusCounts, staleSubmitted] = await Promise.all([
      getIntentStatusCounts(table),
      getStaleSubmitted(table),
    ]);
    snapshot.intents[table] = {
      statusCounts,
      staleSubmitted,
    };
  }

  const stateRows = await getIndexerState();

  if (rpcUrl) {
    const provider = new JsonRpcProvider(rpcUrl);
    const t0 = Date.now();
    try {
      const latestBlock = await provider.getBlockNumber();
      snapshot.rpc.latestBlock = latestBlock;
      snapshot.rpc.latencyMs = Date.now() - t0;
      snapshot.indexer.byChain = stateRows.map((row) => ({
        chainId: Number(row.chainId),
        lastIndexedBlock: Number(row.lastBlock),
        lagBlocks: latestBlock - Number(row.lastBlock),
      }));
    } catch (error) {
      snapshot.rpc.error = error instanceof Error ? error.message : 'RPC error';
      snapshot.indexer.byChain = stateRows.map((row) => ({
        chainId: Number(row.chainId),
        lastIndexedBlock: Number(row.lastBlock),
        lagBlocks: null,
      }));
    }
  } else {
    snapshot.indexer.byChain = stateRows.map((row) => ({
      chainId: Number(row.chainId),
      lastIndexedBlock: Number(row.lastBlock),
      lagBlocks: null,
    }));
  }

  console.log(JSON.stringify(snapshot, null, 2));
} finally {
  await sequelize.close();
}
