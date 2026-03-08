# MVP Go-Live Checklist

Use this checklist as the final gate before opening Brickt to real users.

## 1) Scope Freeze (MVP)

- [ ] Frontend flow is stable for:
  - [ ] Wallet connect/auth
  - [ ] Property browsing/details
  - [ ] USDC investment
  - [ ] Equity claim + profit claim
- [ ] Owner flow is stable for:
  - [ ] Property creation and editing
  - [ ] Campaign finalize + withdraw
  - [ ] Combined settlement wizard (profit + platform fee)
- [ ] No schema-breaking code changes are pending.

## 2) Environment & Secrets

- [ ] Backend `.env` is complete and loaded in runtime shell.
- [ ] `BASE_SEPOLIA_RPC_URL` (or mainnet RPC when launching mainnet) is reachable.
- [ ] Optional fallback RPC URLs are configured and tested.
- [ ] Operator private keys are set (property/profit/platform fee/campaign lifecycle).
- [ ] JWT/auth secrets are set and rotated from defaults.
- [ ] Cloudinary vars are configured if media upload is enabled.
- [ ] `PROCESSING_CRON_TOKEN` is set.
- [ ] `NO_WORKER_MODE` strategy is decided (`true` for scheduled no-worker mode).

## 3) Database & Migrations

- [ ] Run migrations successfully:

```bash
pnpm --filter @homeshare/backend run migrate
```

- [ ] Migration table confirms latest version applied.
- [ ] No startup DB errors in backend logs.

## 4) Processing & Indexer Reliability Gate

- [ ] Chosen mode is stable:
  - [ ] `manual_no_worker` scheduled runs execute without step failures
  - [ ] or `hybrid` workers run without crash loops
- [ ] No sustained RPC detection/connectivity failures.
- [ ] Indexer advances consistently (no persistent lag growth).
- [ ] No growing backlog of `submitted` intents.

## 5) End-to-End Functional Gate

Run one full staged flow on the launch network:

- [ ] Create property
- [ ] Process property intent -> campaign deployed
- [ ] Invest from investor wallet
- [ ] Campaign reaches target/end
- [ ] Finalize + withdraw
- [ ] Submit combined settlement intents
- [ ] Deposit indexed
- [ ] Investor can claim equity and profit

## 6) Observability & Ops

- [ ] `GET /health` is green.
- [ ] `admin/metrics` is available and reviewed.
- [ ] Alerting for processing failures, indexer lag, intent failures is active.
- [ ] Runbook commands are tested by operator once.

## 7) Security & Access

- [ ] Owner allowlist is correct.
- [ ] Admin endpoints require owner auth and are tested.
- [ ] CORS/origin settings match production domains.
- [ ] No secrets in repo history or logs.

## 8) Launch Decision

- [ ] Go/No-Go review completed.
- [ ] Rollback path documented.
- [ ] Incident owner and communication channel assigned.

Only launch when all boxes above are checked.
