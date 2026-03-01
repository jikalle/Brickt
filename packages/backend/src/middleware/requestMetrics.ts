type RouteMetric = {
  count: number;
  errorCount: number;
  totalDurationMs: number;
  maxDurationMs: number;
  lastStatus: number;
  lastSeenAt: string;
};

const routeMetrics = new Map<string, RouteMetric>();
let totalRequests = 0;
let totalErrors = 0;
let totalDurationMs = 0;

const normalizePath = (path: string): string =>
  path
    .replace(/0x[a-fA-F0-9]{40}/g, ':address')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ':uuid')
    .replace(/\/\d+/g, '/:id');

export const observeRequest = (method: string, path: string, statusCode: number, durationMs: number): void => {
  const key = `${method.toUpperCase()} ${normalizePath(path)}`;
  const existing = routeMetrics.get(key) ?? {
    count: 0,
    errorCount: 0,
    totalDurationMs: 0,
    maxDurationMs: 0,
    lastStatus: statusCode,
    lastSeenAt: new Date().toISOString(),
  };

  existing.count += 1;
  existing.totalDurationMs += durationMs;
  existing.maxDurationMs = Math.max(existing.maxDurationMs, durationMs);
  existing.lastStatus = statusCode;
  existing.lastSeenAt = new Date().toISOString();
  if (statusCode >= 400) {
    existing.errorCount += 1;
    totalErrors += 1;
  }

  routeMetrics.set(key, existing);
  totalRequests += 1;
  totalDurationMs += durationMs;
};

export const getRequestMetricsSnapshot = () => {
  const routes = Array.from(routeMetrics.entries())
    .map(([route, metric]) => ({
      route,
      count: metric.count,
      errorCount: metric.errorCount,
      avgDurationMs:
        metric.count > 0
          ? Number((metric.totalDurationMs / metric.count).toFixed(2))
          : 0,
      maxDurationMs: metric.maxDurationMs,
      lastStatus: metric.lastStatus,
      lastSeenAt: metric.lastSeenAt,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  return {
    totalRequests,
    totalErrors,
    errorRate:
      totalRequests > 0 ? Number((totalErrors / totalRequests).toFixed(4)) : 0,
    avgDurationMs:
      totalRequests > 0 ? Number((totalDurationMs / totalRequests).toFixed(2)) : 0,
    routes,
  };
};
