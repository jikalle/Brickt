-- Add retry/dead-letter tracking for platform fee intent execution.

ALTER TABLE platform_fee_intents
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS platform_fee_intents_attempt_idx
  ON platform_fee_intents(attempt_count);
