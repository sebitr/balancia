-- The first account on an instance is its administrator
-- (src/lib/security/admin.ts). That was decided inside the application's
-- INSERT, as `is_admin = NOT EXISTS (SELECT 1 FROM users)`, and it held less
-- than it looked:
--
--  - Under READ COMMITTED the subquery reads a snapshot taken as the statement
--    starts, so two registrations on an empty instance whose INSERTs
--    overlapped could each see nobody and each take the flag.
--  - It was only as good as the paths that remembered to say it. Sign in with
--    Apple writes its own row and did not, so an instance whose first account
--    came from Apple had no administrator at all.
--
-- The rule belongs to the table now. Every row written to "users", by any
-- path, passes through this trigger, which puts the one INSERT that matters —
-- one into an empty table — behind a transaction-scoped advisory lock. A second
-- first signup waits there until the first has committed or rolled back, and
-- only then looks; under READ COMMITTED each statement in a PL/pgSQL function
-- takes a fresh snapshot, so what it looks at includes the row that won.
--
-- Nobody queues once an instance has an account: a committed row means this
-- INSERT is not the first, so that is checked before the lock, not under it.
--
-- `is_admin` stays an ordinary column. An INSERT that asks for true keeps it,
-- and an operator still promotes a second administrator with an UPDATE, which
-- this does not see. More than one administrator is allowed, which is why this
-- is not a unique index on the flag.
--
-- 4207331102 sits beside the migration runner's 4207331101
-- (src/lib/db/migrate.ts).
CREATE FUNCTION "users_first_account_is_admin"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."is_admin" OR EXISTS (SELECT 1 FROM "users") THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(4207331102);
  NEW."is_admin" := NOT EXISTS (SELECT 1 FROM "users");
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "users_first_account_is_admin"
BEFORE INSERT ON "users"
FOR EACH ROW EXECUTE FUNCTION "users_first_account_is_admin"();
