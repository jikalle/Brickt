ALTER TABLE onchain_activities
  DROP CONSTRAINT IF EXISTS onchain_activities_actor_role_check;

UPDATE onchain_activities
SET actor_role = 'worker'
WHERE actor_role = 'investor';

ALTER TABLE onchain_activities
  ADD CONSTRAINT onchain_activities_actor_role_check
  CHECK (actor_role IN ('owner', 'worker'));
