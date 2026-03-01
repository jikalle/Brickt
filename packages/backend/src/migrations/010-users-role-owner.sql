-- Normalize legacy user role values and align constraint with owner/investor model.

UPDATE users
SET role = 'owner'
WHERE role = 'admin';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'users_role_check'
      AND conrelid = 'users'::regclass
  ) THEN
    ALTER TABLE users DROP CONSTRAINT users_role_check;
  END IF;

  ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('owner', 'investor'));
END $$;

