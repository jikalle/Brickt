import { Response } from 'express';
import { QueryTypes } from 'sequelize';
import { getRequestMetricsSnapshot } from '../../middleware/requestMetrics.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sequelize } from '../../db/index.js';
import { sendError } from '../../lib/apiError.js';
import { env } from '../../config/env.js';

export const getAdminMetrics = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const noWorkerModeEnabled = process.env.NO_WORKER_MODE === 'true';
    const memory = process.memoryUsage();
    const metrics = getRequestMetricsSnapshot();
    const rpcUrlConfigured = Boolean(
      process.env.BASE_SEPOLIA_RPC_URL || process.env.BASE_MAINNET_RPC_URL
    );
    let stateRows: Array<{ chain_id: string; last_block: string }> = [];
    try {
      stateRows = await sequelize.query<{ chain_id: string; last_block: string }>(
        `
        SELECT chain_id::text AS chain_id, last_block::text AS last_block
        FROM indexer_state
        ORDER BY chain_id ASC
        `,
        { type: QueryTypes.SELECT }
      );
    } catch (error) {
      const code = (error as { original?: { code?: string } })?.original?.code;
      if (code !== '42P01') {
        throw error;
      }
      // indexer_state might not exist yet on fresh deployments before first indexer run.
      stateRows = [];
    }
    const staleMinutes = 5;
    const staleRows = await sequelize.query<{ count: string }>(
      `
      SELECT COUNT(*)::text AS count
      FROM (
        SELECT id, submitted_at FROM property_intents WHERE status = 'submitted'
        UNION ALL
        SELECT id, submitted_at FROM profit_distribution_intents WHERE status = 'submitted'
        UNION ALL
        SELECT id, submitted_at FROM platform_fee_intents WHERE status = 'submitted'
      ) AS intents
      WHERE submitted_at IS NOT NULL
        AND submitted_at < NOW() - (:staleMinutes::text || ' minutes')::interval
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { staleMinutes },
      }
    );
    const staleSubmittedIntents = Number(staleRows[0]?.count ?? '0');
    const intentRows = await sequelize.query<{
      table_name: string;
      pending: string;
      submitted: string;
      confirmed: string;
      failed: string;
    }>(
      `
      SELECT
        'property_intents'::text AS table_name,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed
      FROM property_intents
      UNION ALL
      SELECT
        'profit_distribution_intents'::text AS table_name,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed
      FROM profit_distribution_intents
      UNION ALL
      SELECT
        'platform_fee_intents'::text AS table_name,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed
      FROM platform_fee_intents
      `,
      { type: QueryTypes.SELECT }
    );
    const settlementRows = await sequelize.query<{
      area: string;
      pending: string;
      submitted: string;
      confirmed: string;
      failed: string;
    }>(
      `
      SELECT
        'platform_fee_transfer'::text AS area,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed
      FROM platform_fee_intents
      WHERE COALESCE(usdc_amount_base_units, 0) > 0
      UNION ALL
      SELECT
        'profit_deposit'::text AS area,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted,
        SUM(CASE WHEN status = 'confirmed' THEN 1 ELSE 0 END)::text AS confirmed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed
      FROM profit_distribution_intents
      `,
      { type: QueryTypes.SELECT }
    );
    const anomalyRows = await sequelize.query<{
      feeTransferStaleSubmitted: string;
      profitDepositStaleSubmitted: string;
      orphanedFeeTransfers: string;
      settlementFailures24h: string;
    }>(
      `
      WITH fee_stale AS (
        SELECT COUNT(*)::text AS value
        FROM platform_fee_intents
        WHERE status = 'submitted'
          AND COALESCE(usdc_amount_base_units, 0) > 0
          AND submitted_at IS NOT NULL
          AND submitted_at < NOW() - INTERVAL '5 minutes'
      ),
      profit_stale AS (
        SELECT COUNT(*)::text AS value
        FROM profit_distribution_intents
        WHERE status = 'submitted'
          AND submitted_at IS NOT NULL
          AND submitted_at < NOW() - INTERVAL '5 minutes'
      ),
      orphaned_fee AS (
        SELECT COUNT(*)::text AS value
        FROM platform_fee_intents pfi
        LEFT JOIN campaigns c ON LOWER(c.contract_address) = LOWER(pfi.campaign_address)
        WHERE COALESCE(pfi.usdc_amount_base_units, 0) > 0
          AND c.id IS NULL
      ),
      recent_failures AS (
        SELECT COUNT(*)::text AS value
        FROM (
          SELECT id, created_at
          FROM platform_fee_intents
          WHERE status = 'failed'
            AND COALESCE(usdc_amount_base_units, 0) > 0
            AND created_at >= NOW() - INTERVAL '24 hours'
          UNION ALL
          SELECT id, created_at
          FROM profit_distribution_intents
          WHERE status = 'failed'
            AND created_at >= NOW() - INTERVAL '24 hours'
        ) x
      )
      SELECT
        (SELECT value FROM fee_stale) AS "feeTransferStaleSubmitted",
        (SELECT value FROM profit_stale) AS "profitDepositStaleSubmitted",
        (SELECT value FROM orphaned_fee) AS "orphanedFeeTransfers",
        (SELECT value FROM recent_failures) AS "settlementFailures24h"
      `,
      { type: QueryTypes.SELECT }
    );
    const faucetCdpConfigured = Boolean(
      process.env.CDP_API_KEY_ID && process.env.CDP_API_KEY_SECRET
    );
    const faucetRows = await sequelize.query<{
      requests24h: string;
      successful24h: string;
      failed24h: string;
      pendingCount: string;
      lastRequestedAt: string | null;
    }>(
      `
      SELECT
        COUNT(*) FILTER (WHERE requested_at >= NOW() - INTERVAL '24 hours')::text AS "requests24h",
        COUNT(*) FILTER (WHERE status = 'confirmed' AND requested_at >= NOW() - INTERVAL '24 hours')::text AS "successful24h",
        COUNT(*) FILTER (WHERE status = 'failed' AND requested_at >= NOW() - INTERVAL '24 hours')::text AS "failed24h",
        COUNT(*) FILTER (WHERE status = 'pending')::text AS "pendingCount",
        MAX(requested_at)::text AS "lastRequestedAt"
      FROM faucet_requests
      `,
      { type: QueryTypes.SELECT }
    ).catch((error) => {
      const code = (error as { original?: { code?: string } })?.original?.code;
      if (code === '42P01') {
        return [
          {
            requests24h: '0',
            successful24h: '0',
            failed24h: '0',
            pendingCount: '0',
            lastRequestedAt: null,
          },
        ];
      }
      throw error;
    });

    const toCount = (tableName: string) => {
      const row = intentRows.find((entry) => entry.table_name === tableName);
      return {
        pending: Number(row?.pending ?? '0'),
        submitted: Number(row?.submitted ?? '0'),
        confirmed: Number(row?.confirmed ?? '0'),
        failed: Number(row?.failed ?? '0'),
      };
    };
    const propertyIntents = toCount('property_intents');
    const profitIntents = toCount('profit_distribution_intents');
    const platformFeeIntents = toCount('platform_fee_intents');
    const toSettlementCount = (area: string) => {
      const row = settlementRows.find((entry) => entry.area === area);
      return {
        pending: Number(row?.pending ?? '0'),
        submitted: Number(row?.submitted ?? '0'),
        confirmed: Number(row?.confirmed ?? '0'),
        failed: Number(row?.failed ?? '0'),
      };
    };
    const platformFeeTransfers = toSettlementCount('platform_fee_transfer');
    const profitDeposits = toSettlementCount('profit_deposit');
    const anomalies = anomalyRows[0] ?? {
      feeTransferStaleSubmitted: '0',
      profitDepositStaleSubmitted: '0',
      orphanedFeeTransfers: '0',
      settlementFailures24h: '0',
    };
    const totals = {
      pending: propertyIntents.pending + profitIntents.pending + platformFeeIntents.pending,
      submitted: propertyIntents.submitted + profitIntents.submitted + platformFeeIntents.submitted,
      confirmed: propertyIntents.confirmed + profitIntents.confirmed + platformFeeIntents.confirmed,
      failed: propertyIntents.failed + profitIntents.failed + platformFeeIntents.failed,
    };

    return res.json({
      timestamp: new Date().toISOString(),
      uptimeSeconds: Number(process.uptime().toFixed(2)),
      process: {
        rssBytes: memory.rss,
        heapUsedBytes: memory.heapUsed,
        heapTotalBytes: memory.heapTotal,
        externalBytes: memory.external,
      },
      indexer: {
        byChain: stateRows.map((row) => ({
          chainId: Number(row.chain_id),
          lastIndexedBlock: Number(row.last_block),
        })),
      },
      health: {
        checks: {
          rpcConfigured: rpcUrlConfigured,
          indexerHealthy: stateRows.length > 0,
          workersHealthy: noWorkerModeEnabled ? true : staleSubmittedIntents === 0,
          faucetHealthy: !process.env.FAUCET_ENABLED || !env.faucetEnabled ? true : faucetCdpConfigured,
        },
        staleSubmittedIntents,
      },
      intents: {
        property: propertyIntents,
        profit: profitIntents,
        platformFee: platformFeeIntents,
        totals,
      },
      settlements: {
        platformFeeTransfers,
        profitDeposits,
        anomalies: {
          feeTransferStaleSubmitted: Number(anomalies.feeTransferStaleSubmitted ?? '0'),
          profitDepositStaleSubmitted: Number(anomalies.profitDepositStaleSubmitted ?? '0'),
          orphanedFeeTransfers: Number(anomalies.orphanedFeeTransfers ?? '0'),
          settlementFailures24h: Number(anomalies.settlementFailures24h ?? '0'),
        },
      },
      faucet: {
        enabled: env.faucetEnabled,
        cdpConfigured: faucetCdpConfigured,
        walletCooldownMinutes: env.faucetWalletCooldownMinutes,
        ipCooldownMinutes: env.faucetIpCooldownMinutes,
        requests24h: Number(faucetRows[0]?.requests24h ?? '0'),
        successful24h: Number(faucetRows[0]?.successful24h ?? '0'),
        failed24h: Number(faucetRows[0]?.failed24h ?? '0'),
        pendingCount: Number(faucetRows[0]?.pendingCount ?? '0'),
        lastRequestedAt: faucetRows[0]?.lastRequestedAt ?? null,
      },
      api: metrics,
    });
  } catch (error) {
    console.error('[observability.metrics] failed', error);
    return sendError(res, 500, 'Failed to fetch admin metrics', 'internal_error');
  }
};
