# Launch-Day Runbook

This is the operator command sheet for MVP launch day.

## 0) Preconditions

- Run from repo root.
- Use one shell with all required backend env vars exported.
- Avoid multiline command wrapping mistakes. Use the commands exactly as shown.

## 1) Build + Migrate

```bash
pnpm --filter @homeshare/backend build
pnpm --filter @homeshare/backend run migrate
pnpm --filter @homeshare/frontend build
```

## 2) Start Backend API

```bash
pnpm --filter @homeshare/backend start
```

If you run API separately in production, start your production process manager command instead.

## 3) Processing Mode

### Preferred: No-Worker Scheduled Mode

Set:

```bash
export NO_WORKER_MODE=true
```

Trigger one cycle:

```bash
curl -X POST "http://localhost:3000/v1/admin/processing/cron?indexerSync=true" \
  -H "x-cron-token: $PROCESSING_CRON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

### Optional: Worker Supervisor (Fallback Mode)

Stop old workers first:

```bash
pkill -f "process:intents:watch|start-intent-workers.mjs|process-property-intents.mjs|process-profit-intents.mjs|process-platform-fee-intents.mjs|process-indexer-sync.mjs|process-campaign-lifecycle.mjs" || true
```

Start workers:

```bash
nohup pnpm --filter @homeshare/backend run process:intents:watch:runtime > /tmp/intent-workers.log 2>&1 &
tail -n 120 /tmp/intent-workers.log
```

Expected startup lines include:
- `started property-worker`
- `started profit-worker`
- `started platform-fee-worker`
- `started indexer-worker`
- `started campaign-lifecycle-worker`

## 4) Quick Health Checks

Backend health:

```bash
curl -sS http://localhost:3000/health
```

Tail workers:

```bash
tail -f /tmp/intent-workers.log
```

Useful checks:

```bash
pnpm --filter @homeshare/backend intents:manage list property_intents pending 20
pnpm --filter @homeshare/backend intents:manage list profit_distribution_intents pending 20
pnpm --filter @homeshare/backend intents:manage list platform_fee_intents pending 20
```

## 5) Smoke Flow (Operator)

1. Create property intent from admin console.
2. Confirm property intent processes to `confirmed`.
3. Make test investment from investor wallet.
4. Confirm investment appears in dashboard/history.
5. Run finalize + withdraw from admin.
6. Submit combined settlement wizard.
7. Confirm deposit indexed.
8. Confirm investor can claim equity/profit.

## 6) Common Recovery Commands

Retry/reset a failed intent:

```bash
pnpm --filter @homeshare/backend intents:manage retry property_intents <INTENT_ID>
pnpm --filter @homeshare/backend intents:manage reset property_intents <INTENT_ID>
```

Process loops once manually:

```bash
pnpm --filter @homeshare/backend process:properties
pnpm --filter @homeshare/backend process:profits
pnpm --filter @homeshare/backend process:platform-fees
pnpm --filter @homeshare/backend process:campaign-lifecycle
```

Force indexer replay from a known block:

```bash
FORCE_START_BLOCK=true START_BLOCK=<BLOCK_NUMBER> BATCH_SIZE=2000 pnpm --filter @homeshare/backend indexer:sync
```

Sync by tx helper:

```bash
pnpm --filter @homeshare/backend indexer:sync:tx -- <TX_HASH>
```

## 7) RPC Instability Playbook

If logs show repeated provider network detection errors:

1. Switch to a stable RPC endpoint.
2. Restart workers with clean env.
3. Re-run a manual single-cycle worker command to validate connectivity.

Example:

```bash
export BASE_SEPOLIA_RPC_URL="https://sepolia.base.org"
unset BASE_SEPOLIA_RPC_FALLBACK_URLS
pkill -f "process:intents:watch|start-intent-workers.mjs" || true
nohup pnpm --filter @homeshare/backend run process:intents:watch:runtime > /tmp/intent-workers.log 2>&1 &
tail -n 120 /tmp/intent-workers.log
```

## 8) Safe Shutdown

```bash
pkill -f "process:intents:watch|start-intent-workers.mjs|process-property-intents.mjs|process-profit-intents.mjs|process-platform-fee-intents.mjs|process-indexer-sync.mjs|process-campaign-lifecycle.mjs" || true
```

Recommended schedule for no-worker mode:
- Every 3 minutes with `indexerSync=false`
- Every 15 minutes with `indexerSync=true`

## 9) Go/No-Go Reminder

Do not go public if any are true:
- Worker crash loop continues.
- Indexer is stale/lagging badly.
- Intents are stuck in submitted state.
- Full flow test is not fully passing.
