# Intent Operations Runbook

This runbook covers operator workflows for admin intent execution and recovery.

## Prerequisites

- Backend build artifacts available (`pnpm --filter @homeshare/backend build`)
- Backend env configured (`DATABASE_URL`, RPC URL, operator key where required)
- Migrations applied (`pnpm --filter @homeshare/backend migrate`)

## Intent Tables

- `property_intents`
- `profit_distribution_intents`
- `platform_fee_intents`

All three use lifecycle fields:
- `status`: `pending` | `submitted` | `confirmed` | `failed`
- `tx_hash`, `error_message`
- `submitted_at`, `confirmed_at`, `updated_at`
- `attempt_count`, `last_attempt_at`

## Commands

Run from repo root.

### 1) Execute platform fee intents

```bash
pnpm --filter @homeshare/backend process:platform-fees
```

This picks retry-eligible intents from `platform_fee_intents` and attempts onchain execution.

### 1b) Reconcile submitted platform fee intents

```bash
pnpm --filter @homeshare/backend reconcile:platform-fees
```

This checks submitted tx receipts and transitions intents to `confirmed` or `failed`.

### 1c) Execute property intents

```bash
pnpm --filter @homeshare/backend process:properties
```

This deploys `PropertyCrowdfund`, `EquityToken`, and `ProfitDistributor` from each pending
property intent using operator key material, then transitions `pending/failed -> submitted -> confirmed`.

Run as continuous worker:

```bash
pnpm --filter @homeshare/backend process:properties:watch
```

Required env for deployment:
- `PROPERTY_OPERATOR_PRIVATE_KEY` (fallback: `PLATFORM_OPERATOR_PRIVATE_KEY`, then `PRIVATE_KEY`)
- Chain RPC URL (`BASE_SEPOLIA_RPC_URL` or `BASE_MAINNET_RPC_URL`)
- USDC token address for target chain (`BASE_SEPOLIA_USDC_ADDRESS` or `BASE_USDC_ADDRESS`)
- Optional worker loop config:
  - `PROPERTY_INTENT_CONTINUOUS=true`
  - `PROPERTY_INTENT_POLL_INTERVAL_MS=15000`

### 2) List intents

```bash
pnpm --filter @homeshare/backend intents:manage -- list platform_fee_intents
pnpm --filter @homeshare/backend intents:manage -- list property_intents failed 50
```

### 3) Inspect an intent

```bash
pnpm --filter @homeshare/backend intents:manage -- inspect platform_fee_intents <intent_id>
```

### 4) Retry a failed intent

```bash
pnpm --filter @homeshare/backend intents:manage -- retry platform_fee_intents <intent_id>
```

Retry resets a failed intent back to `pending` and clears tx/error fields.

### 4b) Attach deployed crowdfund address to a property intent (manual fallback)

```bash
pnpm --filter @homeshare/backend intents:manage -- set-crowdfund <intent_id> <crowdfund_address>
```

Use this if you deploy a crowdfund manually outside the worker. The command resets the intent to
`pending` (unless already `confirmed`) so `process:properties` can execute it.

### 5) Alert check for failed/stale intents

```bash
pnpm --filter @homeshare/backend intents:alert
```

Optional thresholds via env:

```env
INTENT_FAILED_ALERT_THRESHOLD=5
INTENT_SUBMITTED_STALE_MINUTES=30
INTENT_SUBMITTED_STALE_THRESHOLD=5
```

The script exits with status `1` if any threshold is exceeded.

## Recommended Incident Workflow

1. List failed intents by table.
2. Inspect specific intent payload and last error.
3. Fix root cause (RPC, key, address, contract state).
4. For property intents, ensure deployment env/operator key is valid; if manually deployed, set address via `set-crowdfund`.
4. Retry intent.
5. Re-run processor/reconciler and verify `confirmed` status.

## Notes

- `PLATFORM_FEE_INTENT_MAX_ATTEMPTS` caps automatic retries in the processor.
- Manual retry via `intents:manage` is still allowed after remediation.
