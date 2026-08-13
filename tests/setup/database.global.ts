import { Client } from "pg";
import { runMigrations } from "@/lib/db/migrate";

/**
 * Global setup for integration tests.
 *
 * Points at a PostgreSQL instance given by TEST_DATABASE_URL, creates a
 * dedicated test database, and applies the committed migrations — so the tests
 * exercise the same SQL production runs, not a schema push.
 *
 * In CI the instance is a PostgreSQL 18 service container; locally it can be
 * any PostgreSQL 18 (see docs/development.md). If TEST_DATABASE_URL is absent,
 * integration tests fail loudly rather than silently passing against nothing.
 */

const TEMPLATE_SUFFIX = "_vitest";

function requireTestDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Integration tests need TEST_DATABASE_URL (or DATABASE_URL) pointing at a PostgreSQL 18 instance.\n" +
        "See docs/development.md for how to start one.",
    );
  }
  return url;
}

function withDatabaseName(url: string, databaseName: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${databaseName}`;
  return parsed.toString();
}

export default async function setup(): Promise<() => Promise<void>> {
  const baseUrl = requireTestDatabaseUrl();
  const parsed = new URL(baseUrl);
  const originalDatabase = parsed.pathname.replace(/^\//, "") || "postgres";
  const testDatabase = `${originalDatabase}${TEMPLATE_SUFFIX}`;

  const adminUrl = withDatabaseName(baseUrl, "postgres");
  const admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  try {
    // Drop and recreate so every run starts from a known schema.
    await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDatabase}"`);
  } finally {
    await admin.end();
  }

  const testDatabaseUrl = withDatabaseName(baseUrl, testDatabase);
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.BALANCIA_TEST_DATABASE_URL = testDatabaseUrl;

  await runMigrations({ databaseUrl: testDatabaseUrl });

  return async () => {
    const cleanup = new Client({ connectionString: adminUrl });
    await cleanup.connect();
    try {
      await cleanup
        .query(`DROP DATABASE IF EXISTS "${testDatabase}" WITH (FORCE)`)
        .catch(() => undefined);
    } finally {
      await cleanup.end();
    }
  };
}
