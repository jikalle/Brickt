-- Normalize legacy schema variants to the canonical v1 read model.
-- Safe to run on fresh and existing databases.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE IF EXISTS properties
  ADD COLUMN IF NOT EXISTS equity_token_address TEXT,
  ADD COLUMN IF NOT EXISTS profit_distributor_address TEXT;

CREATE INDEX IF NOT EXISTS properties_equity_address_idx
  ON properties(equity_token_address);
CREATE INDEX IF NOT EXISTS properties_profit_distributor_address_idx
  ON properties(profit_distributor_address);

ALTER TABLE IF EXISTS campaigns
  ADD COLUMN IF NOT EXISTS chain_id BIGINT,
  ADD COLUMN IF NOT EXISTS target_usdc_base_units BIGINT,
  ADD COLUMN IF NOT EXISTS raised_usdc_base_units BIGINT DEFAULT 0,
  ADD COLUMN IF NOT EXISTS finalized_tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS finalized_log_index INTEGER,
  ADD COLUMN IF NOT EXISTS finalized_block_number BIGINT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'target_amount_usdc'
  ) THEN
    UPDATE campaigns
    SET target_usdc_base_units = COALESCE(
      target_usdc_base_units,
      ROUND(target_amount_usdc * 1000000)::BIGINT
    )
    WHERE target_usdc_base_units IS NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'campaigns' AND column_name = 'raised_amount_usdc'
  ) THEN
    UPDATE campaigns
    SET raised_usdc_base_units = COALESCE(
      raised_usdc_base_units,
      ROUND(raised_amount_usdc * 1000000)::BIGINT
    )
    WHERE raised_usdc_base_units IS NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS equity_tokens
  ADD COLUMN IF NOT EXISTS chain_id BIGINT,
  ADD COLUMN IF NOT EXISTS total_supply_base_units NUMERIC(78, 0),
  ADD COLUMN IF NOT EXISTS created_log_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_block_number BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'equity_tokens' AND column_name = 'total_supply'
  ) THEN
    UPDATE equity_tokens
    SET total_supply_base_units = COALESCE(
      total_supply_base_units,
      ROUND(total_supply * 1000000000000000000)::NUMERIC(78, 0)
    )
    WHERE total_supply_base_units IS NULL;
  END IF;
END $$;

ALTER TABLE IF EXISTS profit_distributors
  ADD COLUMN IF NOT EXISTS chain_id BIGINT,
  ADD COLUMN IF NOT EXISTS created_log_index INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_block_number BIGINT NOT NULL DEFAULT 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profit_distributors' AND column_name = 'created_block'
  ) THEN
    UPDATE profit_distributors
    SET created_block_number = COALESCE(created_block_number, created_block)
    WHERE created_block_number IS NULL OR created_block_number = 0;
  END IF;
END $$;

ALTER TABLE IF EXISTS profit_claims
  ADD COLUMN IF NOT EXISTS property_id UUID,
  ADD COLUMN IF NOT EXISTS chain_id BIGINT,
  ADD COLUMN IF NOT EXISTS usdc_amount_base_units BIGINT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'profit_claims' AND column_name = 'amount_usdc'
  ) THEN
    UPDATE profit_claims
    SET usdc_amount_base_units = COALESCE(
      usdc_amount_base_units,
      ROUND(amount_usdc * 1000000)::BIGINT
    )
    WHERE usdc_amount_base_units IS NULL;
  END IF;
END $$;
