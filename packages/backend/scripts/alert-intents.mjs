import { JsonRpcProvider } from 'ethers';
import { QueryTypes } from 'sequelize';

process.env.NODE_ENV = process.env.NODE_ENV || 'production';

const { sequelize } = await import('../dist/db/index.js');
await import('../dist/config/env.js');

const failedThreshold = Number(process.env.INTENT_FAILED_ALERT_THRESHOLD || 5);
const submittedAgeMinutes = Number(process.env.INTENT_SUBMITTED_STALE_MINUTES || 30);
const submittedThreshold = Number(process.env.INTENT_SUBMITTED_STALE_THRESHOLD || 5);
const indexerLagThreshold = Number(process.env.INDEXER_LAG_ALERT_THRESHOLD || 200);
const rpcLatencyThresholdMs = Number(process.env.RPC_LATENCY_ALERT_THRESHOLD_MS || 2000);
const rpcUrl =
  process.env.BASE_SEPOLIA_RPC_URL ||
  process.env.BASE_MAINNET_RPC_URL ||
  '';

if (!Number.isFinite(failedThreshold) || failedThreshold < 0) {
  throw new Error('INTENT_FAILED_ALERT_THRESHOLD must be >= 0');
}
if (!Number.isFinite(submittedAgeMinutes) || submittedAgeMinutes <= 0) {
  throw new Error('INTENT_SUBMITTED_STALE_MINUTES must be > 0');
}
if (!Number.isFinite(submittedThreshold) || submittedThreshold < 0) {
  throw new Error('INTENT_SUBMITTED_STALE_THRESHOLD must be >= 0');
}
if (!Number.isFinite(indexerLagThreshold) || indexerLagThreshold < 0) {
  throw new Error('INDEXER_LAG_ALERT_THRESHOLD must be >= 0');
}
if (!Number.isFinite(rpcLatencyThresholdMs) || rpcLatencyThresholdMs <= 0) {
  throw new Error('RPC_LATENCY_ALERT_THRESHOLD_MS must be > 0');
}

const TABLES = [
  'property_intents',
  'profit_distribution_intents',
  'platform_fee_intents',
];

const countFailed = async (table) =>
  sequelize.query(
    `SELECT COUNT(*)::int AS count FROM ${table} WHERE status = 'failed'`,
    { type: QueryTypes.SELECT }
  );

const countSubmittedStale = async (table) =>
  sequelize.query(
    `
    SELECT COUNT(*)::int AS count
    FROM ${table}
    WHERE status = 'submitted'
      AND submitted_at IS NOT NULL
      AND submitted_at < NOW() - make_interval(mins => :minutes)
    `,
    {
      type: QueryTypes.SELECT,
      replacements: { minutes: submittedAgeMinutes },
    }
  );

const toCount = (rows) => {
  if (!Array.isArray(rows) || rows.length === 0) {
    return 0;
  }
  return Number(rows[0].count ?? 0);
};

const loadIndexerState = async () =>
  sequelize.query(
    `
    SELECT chain_id::text AS "chainId", last_block::text AS "lastBlock"
    FROM indexer_state
    ORDER BY chain_id ASC
    `,
    { type: QueryTypes.SELECT }
  );

const summary = {
  timestamp: new Date().toISOString(),
  thresholds: {
    failedThreshold,
    submittedAgeMinutes,
    submittedThreshold,
    indexerLagThreshold,
    rpcLatencyThresholdMs,
  },
  intents: {},
  rpc: {
    enabled: Boolean(rpcUrl),
    latestBlock: null,
    latencyMs: null,
    error: null,
  },
  indexer: {
    byChain: [],
  },
  violations: [],
};

try {
  for (const table of TABLES) {
    const failedRows = await countFailed(table);
    const staleRows = await countSubmittedStale(table);
    const failed = toCount(failedRows);
    const staleSubmitted = toCount(staleRows);

    summary.intents[table] = { failed, staleSubmitted };

    if (failed > failedThreshold) {
      summary.violations.push({
        type: 'intent_failed_threshold',
        table,
        value: failed,
        threshold: failedThreshold,
      });
    }
    if (staleSubmitted > submittedThreshold) {
      summary.violations.push({
        type: 'intent_stale_submitted_threshold',
        table,
        value: staleSubmitted,
        threshold: submittedThreshold,
      });
    }
  }

  const indexerState = await loadIndexerState();
  if (!Array.isArray(indexerState) || indexerState.length === 0) {
    summary.violations.push({
      type: 'indexer_state_missing',
      message: 'indexer_state has no rows',
    });
  }

  if (rpcUrl) {
    const provider = new JsonRpcProvider(rpcUrl);
    const t0 = Date.now();
    try {
      const latestBlock = await provider.getBlockNumber();
      const latencyMs = Date.now() - t0;
      summary.rpc.latestBlock = latestBlock;
      summary.rpc.latencyMs = latencyMs;
      if (latencyMs > rpcLatencyThresholdMs) {
        summary.violations.push({
          type: 'rpc_latency_threshold',
          value: latencyMs,
          threshold: rpcLatencyThresholdMs,
          rpcUrl,
        });
      }

      summary.indexer.byChain = indexerState.map((row) => {
        const lastIndexedBlock = Number(row.lastBlock);
        const lagBlocks = Number.isFinite(lastIndexedBlock)
          ? latestBlock - lastIndexedBlock
          : null;
        if (lagBlocks !== null && lagBlocks > indexerLagThreshold) {
          summary.violations.push({
            type: 'indexer_lag_threshold',
            chainId: Number(row.chainId),
            value: lagBlocks,
            threshold: indexerLagThreshold,
          });
        }
        return {
          chainId: Number(row.chainId),
          lastIndexedBlock,
          lagBlocks,
        };
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.rpc.error = message;
      summary.violations.push({
        type: 'rpc_error',
        message,
        rpcUrl,
      });
      summary.indexer.byChain = indexerState.map((row) => ({
        chainId: Number(row.chainId),
        lastIndexedBlock: Number(row.lastBlock),
        lagBlocks: null,
      }));
    }
  } else {
    summary.rpc.error = 'BASE_SEPOLIA_RPC_URL (or BASE_MAINNET_RPC_URL) is not configured';
    summary.violations.push({
      type: 'rpc_not_configured',
      message: summary.rpc.error,
    });
    summary.indexer.byChain = indexerState.map((row) => ({
      chainId: Number(row.chainId),
      lastIndexedBlock: Number(row.lastBlock),
      lagBlocks: null,
    }));
  }
} finally {
  await sequelize.close();
}

console.log(JSON.stringify(summary, null, 2));

if (summary.violations.length > 0) {
  console.error(
    `[alerts] threshold violations detected: ${summary.violations
      .map((violation) => violation.type)
      .join(', ')}`
  );
  process.exit(1);
}

console.log('[alerts] all checks passed');
