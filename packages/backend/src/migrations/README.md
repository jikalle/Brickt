# Indexer Schema Overview

This folder contains SQL migrations consumed by `src/db/migrate.ts`. The indexer listens to on-chain events from
`PropertyCrowdfund`, `EquityToken`, and `ProfitDistributor`, then upserts rows using `tx_hash`/`log_index` for
idempotency.

## Event-to-Table Mapping

- **PropertyCrowdfund constructor + Finalized/Withdrawn** → `campaigns`
- **PropertyCrowdfund.Invested** → `campaign_investments`
- **PropertyCrowdfund.Refunded** → `campaign_refunds`
- **PropertyCrowdfund.EquityTokenSet / TokensClaimed** → `equity_tokens`, `equity_claims`
- **ProfitDistributor deployment + Deposited** → `profit_distributors`, `profit_deposits`
- **ProfitDistributor.Claimed** → `profit_claims`

## Indexing Flow (high level)

1. Detect contract deployments and insert base rows (campaigns, equity_tokens, profit_distributors).
2. For each relevant event, insert or update rows keyed by `tx_hash` + `log_index`.
3. Update aggregate fields (`raised_usdc_base_units`) as events are processed.
4. Maintain address and `property_id` indexes to support API query patterns.

## Intent Lifecycle

Admin intent tables (`property_intents`, `profit_distribution_intents`, `platform_fee_intents`) use a shared execution lifecycle:

- `status`: `pending` -> `submitted` -> `confirmed` (or `failed`)
- `tx_hash`, `error_message`
- `submitted_at`, `confirmed_at`, `updated_at`
- `attempt_count`, `last_attempt_at`
