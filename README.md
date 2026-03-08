# Brickt

Brickt is a Base-first real estate crowdfunding MVP. Admins create onchain campaigns for properties, investors fund with USDC, and investors later claim equity and distributed profit.

## Live URLs

- Frontend: `https://brickt-frontend.vercel.app`
- Backend API: `https://brickt.onrender.com`

## Current Stack

- `packages/frontend`: React + Vite + wagmi
- `packages/backend`: Express + Sequelize + Postgres
- `packages/contracts`: Solidity + Hardhat
- Network: Base Sepolia (current production/test environment)

## Core Product Flows

- Property creation and updates (including media, YouTube embed, coordinates, strategy `bestFor`)
- Property intent processing -> deploys `PropertyCrowdfund`, `EquityToken`, `ProfitDistributor`
- Investment tracking and campaign lifecycle (`check`, `finalize`, `withdraw`)
- Combined settlement wizard (profit + platform fee)
- Investor claim flows (equity + profit)

## Processing Modes

- `hybrid`: long-running workers + API
- `manual_no_worker`: API with on-demand/scheduled processing endpoint

Current production uses `NO_WORKER_MODE=true` with scheduled calls to:

- `POST /v1/admin/processing/cron`

## Quick Start (Local)

```bash
git clone <your-repo-url>
cd <your-repo-dir>
pnpm install

cp packages/frontend/.env.example packages/frontend/.env.local
cp packages/backend/.env.example packages/backend/.env
cp packages/contracts/.env.example packages/contracts/.env

pnpm --filter @homeshare/contracts compile
pnpm --filter @homeshare/backend migrate
pnpm dev
```

## Documentation

- [Setup](./docs/SETUP.md)
- [Deployment](./docs/DEPLOYMENT.md)
- [Intent Operations](./docs/OPERATIONS_INTENTS.md)
- [Launch-Day Runbook](./docs/LAUNCH_DAY_RUNBOOK.md)
- [MVP Go-Live Checklist](./docs/MVP_GO_LIVE_CHECKLIST.md)
- [API](./docs/API.md)

## License

MIT
