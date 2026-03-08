# Intent Operations Runbook

This runbook covers intent execution and recovery for the current Brickt production model.

## Runtime Model

Primary mode:

- `NO_WORKER_MODE=true`
- Use `POST /v1/admin/processing/cron` for scheduled runs

Fallback mode:

- Continuous workers via `process:intents:watch` when needed

## Intent Tables

- `property_intents`
- `profit_distribution_intents`
- `platform_fee_intents`

Shared lifecycle fields:

- `status`: `pending | submitted | confirmed | failed`
- `tx_hash`, `error_message`
- `attempt_count`, `last_attempt_at`

## Required Prerequisites

- Backend built (`pnpm --filter @homeshare/backend build`)
- Contracts compiled (`pnpm --filter @homeshare/contracts compile`)
- Migrations applied (`pnpm --filter @homeshare/backend migrate`)
- Valid env (`DATABASE_URL`, RPC URL, operator key, `PROCESSING_CRON_TOKEN`)

## Processing Entry Points

### Admin-triggered run

`POST /v1/admin/processing/run` (owner-authenticated)

### Cron-triggered run

`POST /v1/admin/processing/cron` with header:

```http
x-cron-token: <PROCESSING_CRON_TOKEN>
```

Query/body step toggles:

- `propertyIntents`
- `campaignLifecycle`
- `platformFeeIntents`
- `profitIntents`
- `indexerSync`

## Recommended Schedule

- Every 3 minutes: `indexerSync=false`
- Every 15 minutes: `indexerSync=true`

## One-shot CLI Commands

```bash
pnpm --filter @homeshare/backend process:properties
pnpm --filter @homeshare/backend process:campaign-lifecycle
pnpm --filter @homeshare/backend process:platform-fees
pnpm --filter @homeshare/backend process:profits
pnpm --filter @homeshare/backend process:indexer
```

## Intent Inspection and Recovery

List:

```bash
pnpm --filter @homeshare/backend intents:manage list property_intents failed 50
pnpm --filter @homeshare/backend intents:manage list profit_distribution_intents failed 50
pnpm --filter @homeshare/backend intents:manage list platform_fee_intents failed 50
```

Inspect:

```bash
pnpm --filter @homeshare/backend intents:manage inspect property_intents <intent_id>
```

Retry:

```bash
pnpm --filter @homeshare/backend intents:manage retry property_intents <intent_id>
```

Reset:

```bash
pnpm --filter @homeshare/backend intents:manage reset property_intents <intent_id>
```

## Frequent Failures and Fixes

### `Property Intents: failed` quickly with `ENOENT ... artifacts/...json`

Cause: contract artifacts missing in runtime image.
Fix:

```bash
pnpm --filter @homeshare/contracts compile
```

On Render, include contract compile in build command.

### RPC connectivity errors / provider network detection failures

- Switch `BASE_SEPOLIA_RPC_URL` to a healthy endpoint.
- Optionally add `BASE_SEPOLIA_RPC_FALLBACK_URLS`.

### `relation "indexer_state" does not exist`

Run migrations:

```bash
pnpm --filter @homeshare/backend migrate
```

## Verification Endpoints

- `GET /admin/processing/last`
- `GET /admin/metrics`

Success criteria:

- Latest run status is `ok`
- Step statuses are `ok` for enabled steps
- No growing backlog of failed intents
