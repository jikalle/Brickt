-- Compatibility migration.
-- Historically this file contained an alternate/legacy indexer schema.
-- Canonical tables now live in:
--   001-core.sql
--   003-equity-and-profits.sql
-- This file only keeps backward-compatible property linkage columns used by v1 queries.

ALTER TABLE IF EXISTS properties
  ADD COLUMN IF NOT EXISTS equity_token_address TEXT,
  ADD COLUMN IF NOT EXISTS profit_distributor_address TEXT;

CREATE INDEX IF NOT EXISTS properties_equity_address_idx
  ON properties(equity_token_address);
CREATE INDEX IF NOT EXISTS properties_profit_distributor_address_idx
  ON properties(profit_distributor_address);
