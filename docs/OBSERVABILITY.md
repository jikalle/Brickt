# Observability Guide

## Goal

Track production health across:

1. API latency and error rate
2. Indexer lag
3. Intent pipeline failures/stalls
4. RPC health

## Data Sources

### API Metrics (Live)

Endpoint:

```http
GET /v1/admin/metrics
Authorization: Bearer <owner_token>
```

Returns:

- process uptime/memory
- API totals (`totalRequests`, `totalErrors`, `errorRate`, `avgDurationMs`)
- top route metrics (`count`, `errorCount`, `avgDurationMs`, `maxDurationMs`)

### Ops Snapshot

Command:

```bash
pnpm --filter @homeshare/backend observability:snapshot
```

Returns:

- RPC latest block + latency
- indexer `last_block` and lag by `chain_id`
- intent status counts and stale-submitted counts by table

### Alert Gate (Threshold Checks)

Command:

```bash
pnpm --filter @homeshare/backend intents:alert
```

Checks:
- failed/stale intent thresholds per intent table
- RPC connectivity + latency threshold
- indexer lag threshold per chain

Exit behavior:
- `0`: all checks passed
- `1`: one or more threshold violations

## Dashboard Specification

Create four dashboards.

### 1) API Health Dashboard

Panels:

1. `api.errorRate`
2. `api.avgDurationMs`
3. `api.totalRequests` (delta/rate)
4. Top routes by `errorCount`

Alert suggestions:

- error rate > 0.05 for 5 min
- average duration > 1500ms for 10 min

### 2) Indexer Health Dashboard

Panels:

1. `indexer.byChain[].lastIndexedBlock`
2. `indexer.byChain[].lagBlocks`
3. indexer process restart count (from host/PM2)

Alert suggestions:

- lag blocks > 200 for 10 min
- indexer process down

### 3) Intent Pipeline Dashboard

Panels:

1. status counts (`pending`, `submitted`, `confirmed`, `failed`) for:
   - `property_intents`
   - `profit_distribution_intents`
   - `platform_fee_intents`
2. stale submitted count per table
3. failed count trend

Alert suggestions:

- failed count spikes above expected baseline
- stale submitted > 5 for 30+ min

### 4) RPC Health Dashboard

Panels:

1. `rpc.latencyMs`
2. `rpc.latestBlock` progression
3. RPC error presence in snapshot

Alert suggestions:

- RPC latency > 2000ms sustained
- RPC error for 3 consecutive checks

## Collection Cadence

Recommended:

1. Poll `/v1/admin/metrics` every 30-60s.
2. Run `observability:snapshot` every 1-5 min.
3. Store outputs in your metrics backend (Datadog, Grafana stack, etc.).

## Minimal On-Call Checks

1. API error rate and p95 latency acceptable.
2. Indexer lag not growing.
3. No stuck submitted intents.
4. RPC latency stable and no sustained errors.
