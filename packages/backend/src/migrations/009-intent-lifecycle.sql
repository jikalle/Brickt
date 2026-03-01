-- Add execution lifecycle tracking to all admin intent tables.

ALTER TABLE property_intents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'property_intents_status_check'
  ) THEN
    ALTER TABLE property_intents
      ADD CONSTRAINT property_intents_status_check
      CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS property_intents_status_idx
  ON property_intents(status);
CREATE INDEX IF NOT EXISTS property_intents_attempt_idx
  ON property_intents(attempt_count);

ALTER TABLE profit_distribution_intents
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS tx_hash TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS attempt_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'profit_distribution_intents_status_check'
  ) THEN
    ALTER TABLE profit_distribution_intents
      ADD CONSTRAINT profit_distribution_intents_status_check
      CHECK (status IN ('pending', 'submitted', 'confirmed', 'failed'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS profit_distribution_intents_status_idx
  ON profit_distribution_intents(status);
CREATE INDEX IF NOT EXISTS profit_distribution_intents_attempt_idx
  ON profit_distribution_intents(attempt_count);
