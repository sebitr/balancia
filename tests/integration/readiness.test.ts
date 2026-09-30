import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/health/ready/route";
import { getPool } from "@/lib/db/client";
import { migrationNames, migrationsDirectory } from "@/lib/db/migrate";

/**
 * Readiness against a real, fully migrated database: the global setup ran the
 * same runner the image's entrypoint runs, so every committed migration is in
 * `__balancia_migrations`. Each test that disturbs that table puts it back —
 * the rest of the suite shares it.
 */

const BUNDLED = migrationNames(migrationsDirectory());

async function ready() {
  const response = await GET();
  return { status: response.status, body: await response.json() };
}

describe("GET /api/health/ready", () => {
  it("is ready once every migration this image carries has been applied", async () => {
    const { status, body } = await ready();

    expect(status).toBe(200);
    expect(body).toMatchObject({
      status: "ok",
      migrations: BUNDLED.length,
      pendingMigrations: 0,
    });
  });

  it("is not ready while the newest migration is missing", async () => {
    // An image rolled out ahead of its migrations — RUN_MIGRATIONS=false, and
    // the operator has not run them yet. Its code expects the newest schema,
    // so traffic must wait for it rather than meet a 500.
    const pool = getPool();
    const newest = BUNDLED.at(-1);
    const { rows } = await pool.query<{ name: string; checksum: string }>(
      'DELETE FROM "__balancia_migrations" WHERE name = $1 RETURNING name, checksum',
      [newest],
    );
    try {
      const { status, body } = await ready();

      expect(status).toBe(503);
      expect(body).toMatchObject({
        status: "starting",
        reason: "migrations-not-applied",
        migrations: BUNDLED.length - 1,
        pendingMigrations: 1,
      });
    } finally {
      for (const row of rows) {
        await pool.query(
          'INSERT INTO "__balancia_migrations" (name, checksum) VALUES ($1, $2)',
          [row.name, row.checksum],
        );
      }
    }

    expect((await ready()).status).toBe(200);
  });

  it("stays ready on a database a later release has already migrated", async () => {
    // Rolling back the image leaves the schema ahead of the code. Whether to
    // run like that is the migration step's decision (ALLOW_NEWER_SCHEMA);
    // an app that got past it is serving, and readiness says so.
    const pool = getPool();
    await pool.query(
      `INSERT INTO "__balancia_migrations" (name, checksum) VALUES ('9999_from_a_later_release.sql', 'test')`,
    );
    try {
      const { status, body } = await ready();

      expect(status).toBe(200);
      expect(body).toMatchObject({
        migrations: BUNDLED.length + 1,
        pendingMigrations: 0,
      });
    } finally {
      await pool.query(
        `DELETE FROM "__balancia_migrations" WHERE name = '9999_from_a_later_release.sql'`,
      );
    }
  });
});
