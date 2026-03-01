# Homeshare v2 Architecture

## Overview

Homeshare v2 is a Base-native real-estate crowdfunding platform. The current `v1` stack is centered on Base Sepolia (`84532`) for indexed data and API validation, with Base mainnet as the launch target.

The product model:
- Investors contribute USDC to campaign contracts.
- Investors claim equity tokens after successful campaigns.
- Property owners deposit USDC profits for token-holder claims.
- Platform monetization comes from campaign-level platform fees configured onchain.

## High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Frontend (React + Vite + TypeScript)                       │
│ - Property browsing, dashboards, owner console             │
│ - Wallet auth via Sign in with Base                        │
└──────────────────┬──────────────────────────────────────────┘
                   │ REST API + wallet signatures
┌──────────────────┴──────────────────────────────────────────┐
│ Backend (Express + TypeScript + PostgreSQL)                │
│ - /v1 API (query + auth + admin intent creation)           │
│ - Indexer (onchain logs -> DB read model)                  │
│ - Operator jobs (intent execution, e.g. platform fees)     │
└──────────────────┬──────────────────────────────────────────┘
                   │ RPC
┌──────────────────┴──────────────────────────────────────────┐
│ Smart Contracts (Base)                                     │
│ - PropertyCrowdfund                                        │
│ - EquityToken                                              │
│ - ProfitDistributor                                        │
└─────────────────────────────────────────────────────────────┘
```

## Monorepo Packages

### Frontend (`packages/frontend`)
- React 18 + TypeScript + Vite.
- Uses `@base-org/account` and `@base-org/account-ui` for SIWB flows.
- Uses `/v1` backend endpoints for properties, campaigns, portfolio, and owner intents.

### Backend (`packages/backend`)
- Express app with `v1` routes in [`src/routes/v1.ts`](../packages/backend/src/routes/v1.ts).
- Wallet auth (`/v1/auth/*`) with nonce + signature verification.
- PostgreSQL-backed read model and intent tables.
- Indexer in [`src/indexer/indexer.ts`](../packages/backend/src/indexer/indexer.ts) for event ingestion and reorg-safe replay.

### Contracts (`packages/contracts`)
- `PropertyCrowdfund.sol`: USDC raise, finalize, refund, withdraw, token claim, platform fee.
- `EquityToken.sol`: tokenized ownership supply.
- `ProfitDistributor.sol`: accumulator-based USDC profit distribution.

## API Shape (Current)

- Preferred base path: `/v1/*`.
- Legacy data routes under `/api/properties`, `/api/investments`, `/api/chains`, `/api/tokens` are hard-deprecated (`410 Gone`).
- Auth alias `/api/auth/*` remains for compatibility.

Primary groups:
- Public queries: `/v1/properties`, `/v1/campaigns`.
- User portfolio queries: `/v1/me/*` (JWT required).
- Owner intents: `/v1/admin/*/intents` (owner role required).

## Data Flow

### Investment and Portfolio Read Flow
1. Investor transacts directly with `PropertyCrowdfund` onchain.
2. Backend indexer ingests `Invested`, `Refunded`, `Finalized`, `TokensClaimed`.
3. Read model tables are updated in PostgreSQL.
4. Frontend queries `/v1` endpoints for campaign and portfolio views.

### Profit Distribution Flow
1. Owner deposits USDC into `ProfitDistributor`.
2. Investors claim USDC profits from `ProfitDistributor`.
3. Indexer ingests `Deposited` and `Claimed` events.
4. Frontend renders claim history via `/v1/properties/:id/profit-*` and `/v1/me/profit-claims`.

### Platform Fee Flow
1. Owner submits platform fee intent via `/v1/admin/platform-fees/intents`.
2. Backend stores intent (`platform_fee_intents`).
3. Operator script executes `setPlatformFee(...)` on the campaign.
4. Intent status moves `pending -> submitted -> confirmed` (or `failed`).

## Operational Boundaries

- Current chain validation in `v1` controllers is Base Sepolia-first.
- Owner actions are intent-based; onchain execution is handled by operator automation/scripts.
- DB is a derived read model from chain events; indexer replay is required for recovery.

## Security Notes

- Contracts use OpenZeppelin patterns (`Ownable`, `ReentrancyGuard`, `SafeERC20`).
- Auth uses nonce-based message signing and JWT issuance.
- Owner privileges are gated by backend allowlist (`OWNER_ALLOWLIST`).
