import { Response } from 'express';
import { QueryTypes } from 'sequelize';
import { getRequestMetricsSnapshot } from '../../middleware/requestMetrics.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';
import { sequelize } from '../../db/index.js';
import { sendError } from '../../lib/apiError.js';

export const getAdminMetrics = async (_req: AuthenticatedRequest, res: Response) => {
  try {
    const memory = process.memoryUsage();
    const metrics = getRequestMetricsSnapshot();
    const stateRows = await sequelize.query<{ chain_id: string; last_block: string }>(
      `
      SELECT chain_id::text AS chain_id, last_block::text AS last_block
      FROM indexer_state
      ORDER BY chain_id ASC
      `,
      { type: QueryTypes.SELECT }
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
      api: metrics,
    });
  } catch (error) {
    console.error('[observability.metrics] failed', error);
    return sendError(res, 500, 'Failed to fetch admin metrics', 'internal_error');
  }
};
