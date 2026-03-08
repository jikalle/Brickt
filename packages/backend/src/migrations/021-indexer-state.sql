-- Ensure indexer_state exists for admin observability/preflight endpoints.

CREATE TABLE IF NOT EXISTS indexer_state (
  chain_id BIGINT PRIMARY KEY,
  last_block BIGINT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS indexer_state_last_block_idx
  ON indexer_state(last_block);
