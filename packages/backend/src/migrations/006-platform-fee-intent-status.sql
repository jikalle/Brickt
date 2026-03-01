-- Add execution lifecycle tracking for platform fee intents.

ALTER TABLE platform_fee_intents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'platform_fee_intents_status_check'
  ) THEN
    ALTER TABLE platform_fee_intents
      ADD CONSTRAINT platform_fee_intents_status_check
      CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS platform_fee_intents_status_idx
  ON platform_fee_intents(status);
