-- Property strategy classification for listing and investor context.

ALTER TABLE properties
  ADD COLUMN IF NOT EXISTS best_for TEXT;

ALTER TABLE property_intents
  ADD COLUMN IF NOT EXISTS best_for TEXT;

ALTER TABLE properties
  DROP CONSTRAINT IF EXISTS properties_best_for_check;
ALTER TABLE properties
  ADD CONSTRAINT properties_best_for_check
  CHECK (
    best_for IS NULL OR best_for IN ('sell', 'rent', 'build_and_sell', 'build_and_rent')
  );

ALTER TABLE property_intents
  DROP CONSTRAINT IF EXISTS property_intents_best_for_check;
ALTER TABLE property_intents
  ADD CONSTRAINT property_intents_best_for_check
  CHECK (
    best_for IS NULL OR best_for IN ('sell', 'rent', 'build_and_sell', 'build_and_rent')
  );
