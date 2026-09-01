import { afterAll, beforeEach } from "vitest";
import { getPool, closeDb } from "@/lib/db/client";

/**
 * Per-file setup for integration tests.
 *
 * Each test starts from an empty set of domain tables. Truncating with CASCADE
 * and RESTART IDENTITY is fast enough at this scale and keeps tests independent
 * without the complexity of nested-transaction rollback (which would fight the
 * transactions the services under test open themselves).
 */

const DOMAIN_TABLES = [
  "activity_events",
  "attachments",
  "notifications",
  "notification_preferences",
  "notification_group_mutes",
  "push_subscriptions",
  "imported_fingerprints",
  "import_rows",
  "import_runs",
  "recurring_occurrences",
  "recurring_expenses",
  "expense_shares",
  "expense_payers",
  "expenses",
  "settlements",
  "guest_sessions",
  "guest_invitations",
  "rate_limits",
  "exchange_rate_quotes",
  "telemetry_counters",
  "telemetry_reports",
  "telemetry_daily_stats",
  // Truncated like the rest: a test that switched telemetry on must not leave
  // it on for the next one. Readers treat a missing row as "everything off",
  // which is the same answer the migration's seeded row gives.
  "instance_settings",
  "group_members",
  "participants",
  "groups",
  "verification_tokens",
  "webauthn_challenges",
  "proof_of_work_challenges",
  "passkeys",
  "sessions",
  "users",
];

beforeEach(async () => {
  const pool = getPool();
  await pool.query(
    `TRUNCATE TABLE ${DOMAIN_TABLES.join(", ")} RESTART IDENTITY CASCADE`,
  );
});

afterAll(async () => {
  await closeDb();
});
