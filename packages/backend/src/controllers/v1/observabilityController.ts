import { Response } from 'express';
import { getRequestMetricsSnapshot } from '../../middleware/requestMetrics.js';
import { AuthenticatedRequest } from '../../middleware/auth.js';

export const getAdminMetrics = (_req: AuthenticatedRequest, res: Response) => {
  const memory = process.memoryUsage();
  const metrics = getRequestMetricsSnapshot();

  return res.json({
    timestamp: new Date().toISOString(),
    uptimeSeconds: Number(process.uptime().toFixed(2)),
    process: {
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
    },
    api: metrics,
  });
};
