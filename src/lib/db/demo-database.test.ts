import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";

/**
 * The guarantee a demo instance rests on: it never opens a connection.
 *
 * Worth its own test because the failure is invisible from the outside. An
 * instance that quietly fell back to `DATABASE_URL` would serve the same
 * pages, pass the same checks, and be writing strangers' demo expenses into a
 * production database.
 */

process.env.DEMO_MODE = "true";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef0123456789";
resetEnvCache();

const { bootstrapDemoDatabase, closeDemoDatabase } =
  await import("./demo-database");
const { getDb, getPool } = await import("./client");

beforeAll(async () => {
  await bootstrapDemoDatabase();
}, 60_000);

afterAll(async () => {
  await closeDemoDatabase();
});

describe("a demo instance", () => {
  it("answers queries without a PostgreSQL connection", async () => {
    const { sql } = await import("drizzle-orm");
    const result = await getDb().execute(sql`SELECT 1 AS one`);

    expect((result.rows[0] as { one: number }).one).toBe(1);
    // globalThis.__balanciaPool is where client.ts caches a real pool. Still
    // undefined after a query is the whole claim.
    expect(globalThis.__balanciaPool).toBeUndefined();
  });

  it("refuses to build a pool at all, and says why", () => {
    expect(() => getPool()).toThrow(/demo instance/i);
  });

  it("bootstraps once, however many callers ask", async () => {
    const [first, second] = await Promise.all([
      bootstrapDemoDatabase(),
      bootstrapDemoDatabase(),
    ]);

    expect(first).toBe(second);
    expect(first).toBe(getDb());
  });
});
