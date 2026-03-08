# Deployment Guide (Brickt)

This guide documents the current production deployment used by Brickt.

## Architecture

- Frontend: Vercel (`packages/frontend`)
- Backend API: Render (`packages/backend`)
- Database: Supabase Postgres
- Chain: Base Sepolia
- Processing mode: `NO_WORKER_MODE=true` with scheduled `/v1/admin/processing/cron`

## 1) Backend on Render

Create a Render Web Service from this repository.

Build command:

```bash
npm i -g pnpm@10.27.0 && pnpm install --frozen-lockfile && pnpm --filter @homeshare/contracts compile && pnpm --filter @homeshare/backend build
```

Start command:

```bash
pnpm --filter @homeshare/backend start
```

Required environment variables:

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgres://...   # Supabase pooled URL
JWT_SECRET=...
OWNER_ALLOWLIST=0x...
NO_WORKER_MODE=true
PROCESSING_CRON_TOKEN=...

BASE_SEPOLIA_RPC_URL=https://base-sepolia-rpc.publicnode.com
BASE_SEPOLIA_RPC_FALLBACK_URLS=https://base-sepolia.blockpi.network/v1/rpc/public

PRIVATE_KEY=0x...
PROPERTY_OPERATOR_PRIVATE_KEY=0x...
PLATFORM_OPERATOR_PRIVATE_KEY=0x...
PROFIT_OPERATOR_PRIVATE_KEY=0x...
```

After deploy, open Render shell and run migrations:

```bash
cd ~/project/src
pnpm --filter @homeshare/backend migrate
```

## 2) Frontend on Vercel

Create a Vercel project from this repo with:

- Root directory: `packages/frontend`
- Build command: `pnpm build`
- Output directory: `dist`

Frontend env:

```env
VITE_APP_NAME=Brickt
VITE_API_BASE_URL=https://brickt.onrender.com
VITE_OWNER_ALLOWLIST=0x...
```

## 3) Initial Verification

1. Health check:

```bash
curl -sS https://brickt.onrender.com/health
```

2. Admin login using allowlisted wallet.
3. Create one property intent.
4. Run processing from admin console.
5. Confirm `GET /v1/admin/processing/last` shows all enabled steps as `ok`.

## 4) Scheduled Processing (No-Worker Mode)

Schedule two POST jobs against:

`https://brickt.onrender.com/v1/admin/processing/cron`

Required header:

```http
x-cron-token: <PROCESSING_CRON_TOKEN>
```

Recommended cadence:

- Every 3 minutes: `?indexerSync=false`
- Every 15 minutes: `?indexerSync=true`

## 5) Troubleshooting

### `Property Intents: failed` with `ENOENT ... artifacts/...json`

Cause: contracts artifacts missing at runtime image.
Fix: include `pnpm --filter @homeshare/contracts compile` in Render build command.

### `relation "indexer_state" does not exist`

Cause: migrations not applied.
Fix:

```bash
pnpm --filter @homeshare/backend migrate
```

### `Invalid database connection URL format`

Cause: bad or missing `DATABASE_URL`.
Fix: set a valid `postgres://` or `postgresql://` URL and redeploy.

## 6) Operations Baseline

Production is healthy when:

- `GET /v1/admin/metrics` returns 200
- `GET /v1/admin/processing/last` returns successful runs
- New property intents confirm onchain
- Settlement steps complete without manual SQL intervention
