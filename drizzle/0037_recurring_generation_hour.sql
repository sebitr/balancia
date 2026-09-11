--
-- Recurring expenses used to become due at midnight in the group's timezone,
-- and generating one notifies everybody it splits between — so a monthly rent
-- woke a whole flat at 00:00 on the first of every month. The hour is now
-- 09:00; see `GENERATION_HOUR` in `src/modules/recurring/schedule.ts`.
--
-- Every template already carries a `next_run_at` pinned to the old midnight,
-- so they are moved to nine on the same calendar date they already name — the
-- date is not being changed here, only the hour of it.
--
-- Only the ones still in the future. A `next_run_at` already in the past means
-- the worker is behind, and pushing it nine hours further out would delay a
-- catch-up that was owed; those are left where they are and land on nine on
-- their next tick, because the worker recomputes `next_run_at` from the rule
-- every time it looks at a template.
--
-- The timezone test is not paranoia about our own data: `AT TIME ZONE` raises
-- on a name Postgres does not know, and a zone this database has not heard of
-- would fail the migration and with it the deployment. A row skipped here is
-- a row the worker fixes on its next tick anyway, which is the whole reason
-- this migration is a courtesy rather than a correction.
--
UPDATE "recurring_expenses"
SET "next_run_at" =
  ((("next_run_at" AT TIME ZONE "timezone")::date + TIME '09:00') AT TIME ZONE "timezone")
WHERE "next_run_at" > now()
  AND EXISTS (
    SELECT 1 FROM pg_timezone_names WHERE "name" = "recurring_expenses"."timezone"
  );
