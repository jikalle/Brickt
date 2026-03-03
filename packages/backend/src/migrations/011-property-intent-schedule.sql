-- Allow owner to set explicit campaign start/end times during property intent creation.

ALTER TABLE property_intents
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;
