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

    const autonomousRows = await sequelize.query<{
      propertyId: string;
      campaignAddress: string;
      state: string;
      raisedUsdcBaseUnits: string;
      targetUsdcBaseUnits: string;
      endTime: string | null;
      equityTokenAddress: string | null;
      profitDistributorAddress: string | null;
      archivedAt: string | null;
      propertyIntentPending: string;
      propertyIntentFailed: string;
      profitIntentPending: string;
      profitIntentSubmitted: string;
      profitIntentFailed: string;
      platformFeeIntentPending: string;
      platformFeeIntentSubmitted: string;
      platformFeeIntentFailed: string;
      profitDepositsIndexed: string;
      latestAgentEventType: string | null;
      latestAgentCreatedAt: string | null;
    }>(
      `
      WITH latest_agent AS (
        SELECT DISTINCT ON (LOWER(campaign_address))
          LOWER(campaign_address) AS campaign_address,
          event_type,
          created_at
        FROM agent_activities
        WHERE campaign_address IS NOT NULL
        ORDER BY LOWER(campaign_address), created_at DESC
      ),
      property_intent_stats AS (
        SELECT
          property_id,
          SUM(CASE WHEN status IN ('pending', 'submitted') THEN 1 ELSE 0 END)::text AS pending_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed_count
        FROM property_intents
        GROUP BY property_id
      ),
      profit_intent_stats AS (
        SELECT
          property_id,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending_count,
          SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed_count
        FROM profit_distribution_intents
        GROUP BY property_id
      ),
      platform_fee_intent_stats AS (
        SELECT
          LOWER(campaign_address) AS campaign_address,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END)::text AS pending_count,
          SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END)::text AS submitted_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::text AS failed_count
        FROM platform_fee_intents
        GROUP BY LOWER(campaign_address)
      ),
      profit_deposit_stats AS (
        SELECT
          LOWER(campaign_address) AS campaign_address,
          COUNT(*)::text AS indexed_count
        FROM profit_deposits
        GROUP BY LOWER(campaign_address)
      )
      SELECT
        c.property_id AS "propertyId",
        LOWER(c.contract_address) AS "campaignAddress",
        c.state,
        c.raised_usdc_base_units::text AS "raisedUsdcBaseUnits",
        c.target_usdc_base_units::text AS "targetUsdcBaseUnits",
        c.end_time::text AS "endTime",
        LOWER(NULLIF(p.equity_token_address, '')) AS "equityTokenAddress",
        LOWER(NULLIF(p.profit_distributor_address, '')) AS "profitDistributorAddress",
        p.archived_at::text AS "archivedAt",
        COALESCE(pis.pending_count, '0') AS "propertyIntentPending",
        COALESCE(pis.failed_count, '0') AS "propertyIntentFailed",
        COALESCE(pris.pending_count, '0') AS "profitIntentPending",
        COALESCE(pris.submitted_count, '0') AS "profitIntentSubmitted",
        COALESCE(pris.failed_count, '0') AS "profitIntentFailed",
        COALESCE(pfis.pending_count, '0') AS "platformFeeIntentPending",
        COALESCE(pfis.submitted_count, '0') AS "platformFeeIntentSubmitted",
        COALESCE(pfis.failed_count, '0') AS "platformFeeIntentFailed",
        COALESCE(pds.indexed_count, '0') AS "profitDepositsIndexed",
        la.event_type AS "latestAgentEventType",
        la.created_at::text AS "latestAgentCreatedAt"
      FROM campaigns c
      JOIN properties p
        ON p.chain_id = c.chain_id
       AND p.property_id = c.property_id
       AND LOWER(p.crowdfund_contract_address) = LOWER(c.contract_address)
      LEFT JOIN property_intent_stats pis
        ON pis.property_id = c.property_id
      LEFT JOIN profit_intent_stats pris
        ON pris.property_id = c.property_id
      LEFT JOIN platform_fee_intent_stats pfis
        ON pfis.campaign_address = LOWER(c.contract_address)
      LEFT JOIN profit_deposit_stats pds
        ON pds.campaign_address = LOWER(c.contract_address)
      LEFT JOIN latest_agent la
        ON la.campaign_address = LOWER(c.contract_address)
      WHERE c.chain_id = :chainId
        AND p.archived_at IS NULL
      ORDER BY c.created_at DESC
      `,
      {
        type: QueryTypes.SELECT,
        replacements: { chainId: env.baseSepoliaChainId ?? 84532 },
      }
    );

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

    const nowMs = Date.now();
    const autonomousCampaigns = autonomousRows.map((row) => {
      const raised = BigInt(row.raisedUsdcBaseUnits ?? '0');
      const target = BigInt(row.targetUsdcBaseUnits ?? '0');
      const endMs = row.endTime ? Number(row.endTime) * 1000 : null;
      const isEnded = typeof endMs === 'number' ? endMs <= nowMs : false;
      const hasFailedOps =
        Number(row.propertyIntentFailed) > 0 ||
        Number(row.profitIntentFailed) > 0 ||
        Number(row.platformFeeIntentFailed) > 0;
      const hasPendingOps =
        Number(row.propertyIntentPending) > 0 ||
        Number(row.profitIntentPending) > 0 ||
        Number(row.profitIntentSubmitted) > 0 ||
        Number(row.platformFeeIntentPending) > 0 ||
        Number(row.platformFeeIntentSubmitted) > 0;
      const hasProfitDeposits = Number(row.profitDepositsIndexed) > 0;
      const hasEquityToken = Boolean(row.equityTokenAddress);
      let stage:
        | 'monitor'
        | 'ready_finalize'
        | 'ready_withdraw'
        | 'ready_repair'
        | 'ready_profit_flow'
        | 'blocked'
        | 'completed'
        | 'closed_failed' = 'monitor';
      let recommendedAction = 'Monitor';
      let blockedReasons: string[] = [];

      if (row.state === 'FAILED') {
        stage = 'closed_failed';
        recommendedAction = 'Closed';
      } else if (row.state === 'WITHDRAWN' && hasProfitDeposits) {
        stage = 'completed';
        recommendedAction = 'Completed';
      } else if (hasFailedOps) {
        stage = 'blocked';
        recommendedAction = 'Investigate';
        if (Number(row.propertyIntentFailed) > 0) blockedReasons.push('property intent failed');
        if (Number(row.profitIntentFailed) > 0) blockedReasons.push('profit intent failed');
        if (Number(row.platformFeeIntentFailed) > 0) blockedReasons.push('platform fee intent failed');
      } else if (row.state === 'ACTIVE' && (raised >= target || isEnded)) {
        stage = 'ready_finalize';
        recommendedAction = 'Finalize';
      } else if (row.state === 'SUCCESS') {
        stage = 'ready_withdraw';
        recommendedAction = 'Withdraw';
      } else if (row.state === 'WITHDRAWN' && !hasEquityToken) {
        stage = 'ready_repair';
        recommendedAction = 'Repair setup';
      } else if (row.state === 'WITHDRAWN' && !hasProfitDeposits) {
        stage = hasPendingOps ? 'blocked' : 'ready_profit_flow';
        recommendedAction = hasPendingOps ? 'Wait for queued settlement' : 'Submit profit flow';
        if (hasPendingOps) blockedReasons.push('settlement intent already pending');
      }

      if (!rpcUrlConfigured) blockedReasons.push('rpc not configured');
      if (stateRows.length === 0) blockedReasons.push('indexer not healthy');
      if (!noWorkerModeEnabled && staleSubmittedIntents > 0) blockedReasons.push('worker backlog detected');
      if (stage !== 'closed_failed' && stage !== 'completed' && blockedReasons.length > 0 && stage !== 'blocked') {
        stage = 'blocked';
        recommendedAction = 'Investigate';
      }

      return {
        propertyId: row.propertyId,
        campaignAddress: row.campaignAddress,
        state: row.state,
        stage,
        recommendedAction,
        raisedUsdcBaseUnits: row.raisedUsdcBaseUnits,
        targetUsdcBaseUnits: row.targetUsdcBaseUnits,
        blockedReasons,
        latestAgentEventType: row.latestAgentEventType,
        latestAgentCreatedAt: row.latestAgentCreatedAt,
      };
    });

    const autonomousTotals = autonomousCampaigns.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.stage] += 1;
        return acc;
      },
      {
        total: 0,
        monitor: 0,
        ready_finalize: 0,
        ready_withdraw: 0,
        ready_repair: 0,
        ready_profit_flow: 0,
        blocked: 0,
        completed: 0,
        closed_failed: 0,
      }
    );

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
      autonomousOps: {
        totals: autonomousTotals,
        campaigns: autonomousCampaigns.slice(0, 12),
      },
      api: metrics,
    });
  } catch (error) {
    console.error('[observability.metrics] failed', error);
    return sendError(res, 500, 'Failed to fetch admin metrics', 'internal_error');
  }
};
