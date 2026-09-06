import { readFileSync } from "node:fs";
import path from "node:path";
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

/**
 * The other half of the guarantee, and the one nothing else notices.
 *
 * PGlite ships pre-minified ESM that reaches its WebAssembly two ways a
 * bundler breaks: the payload is addressed as
 * `new URL("./pglite.wasm", import.meta.url)`, and the `instantiateWasm` hook
 * its Emscripten glue calls is a cross-chunk import sharing a name with the
 * option it is assigned to. Bundled, the two collapse together and
 * `bootstrapDemoDatabase()` throws `h.instantiateWasm is not a function`.
 *
 * That happens in the instrumentation hook, before the first request, so
 * there is no page to show it: every path answers Internal Server Error and
 * the log says nothing about a database. This suite cannot catch it — Vitest
 * imports PGlite from node_modules, exactly as the fix arranges for Next to —
 * so the fix is asserted where it lives instead.
 */
describe("the demo database's bundling", () => {
  it("is left to Node, not to Turbopack", () => {
    const config = readFileSync(
      path.join(process.cwd(), "next.config.ts"),
      "utf8",
    );
    const list = /serverExternalPackages:\s*\[([^\]]*)\]/.exec(config)?.[1];

    expect(
      list,
      "next.config.ts no longer declares serverExternalPackages",
    ).toBeDefined();
    expect(
      list,
      "@electric-sql/pglite must stay out of the bundler, or DEMO_MODE=true " +
        "cannot start: see the comment above serverExternalPackages",
    ).toContain("@electric-sql/pglite");
  });
});
