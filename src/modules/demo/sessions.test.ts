import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resetEnvCache } from "@/lib/env";

/**
 * The demo, end to end, with no PostgreSQL anywhere.
 *
 * This is a unit test rather than an integration one, and that is the point:
 * the in-memory database it exercises is the same one a demo instance serves
 * from, so the whole path — minting an account, seeding it through the real
 * services, authorizing a group, sweeping it away — runs in a plain `vitest`
 * process. Nothing here needs `tests/setup/database.global.ts`.
 */

// Set before anything imports `env.ts`, which caches on first read.
process.env.DEMO_MODE = "true";
delete process.env.DATABASE_URL;
process.env.AUTH_SECRET = "0123456789abcdef0123456789abcdef0123456789";
resetEnvCache();

const { bootstrapDemoDatabase, closeDemoDatabase } =
  await import("@/lib/db/demo-database");
const { getDb } = await import("@/lib/db/client");
const { authorizeGroup } = await import("@/lib/security/authorization");
const { startDemoSession, sweepDemoSessions, liveDemoCount } =
  await import("./sessions");
const { listGroupsForUser } = await import("@/modules/groups/service");

beforeAll(async () => {
  await bootstrapDemoDatabase();
}, 60_000);

afterAll(async () => {
  await closeDemoDatabase();
});

describe("the demo database", () => {
  it("applies every committed migration", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync("drizzle").filter((name) =>
      name.endsWith(".sql"),
    );

    const { sql } = await import("drizzle-orm");
    const result = await getDb().execute(
      sql`SELECT count(*)::int AS applied FROM "__balancia_migrations"`,
    );

    expect((result.rows[0] as { applied: number }).applied).toBe(files.length);
  });

  it("hands dates back as calendar strings, not Date objects", async () => {
    // node-postgres does this and src/lib/db/client.ts keeps it that way. A
    // Date here would move an expense recorded on the 1st to the 31st for
    // anyone west of UTC — silently, and only for some readers.
    const { sql } = await import("drizzle-orm");
    const result = await getDb().execute(sql`SELECT '2026-01-31'::date AS d`);

    expect((result.rows[0] as { d: unknown }).d).toBe("2026-01-31");
  });
});

describe("starting a demo session", () => {
  it("gives each visitor their own populated workspace", async () => {
    const first = await startDemoSession();
    const second = await startDemoSession();

    expect(first.user.userId).not.toBe(second.user.userId);

    const firstGroups = await listGroupsForUser(first.user.userId);
    const secondGroups = await listGroupsForUser(second.user.userId);

    // The seeded workspace: a converted-currency trip and a separate one.
    expect(firstGroups).toHaveLength(2);
    expect(secondGroups).toHaveLength(2);
    expect(firstGroups.map((group) => group.id).sort()).not.toEqual(
      secondGroups.map((group) => group.id).sort(),
    );
  }, 60_000);

  it("does not let one visitor reach another's group", async () => {
    const first = await startDemoSession();
    const second = await startDemoSession();
    const [victimGroup] = await listGroupsForUser(first.user.userId);

    // Not a filtered-out empty result: authorization refuses outright, the
    // same way it does for two unrelated real accounts.
    await expect(authorizeGroup(second.user, victimGroup.id)).rejects.toThrow();
  }, 60_000);
});

describe("sweeping", () => {
  it("removes a visitor's account and their groups once expired", async () => {
    const before = liveDemoCount();
    const demo = await startDemoSession();
    expect(liveDemoCount()).toBe(before + 1);

    const [group] = await listGroupsForUser(demo.user.userId);

    // Three hours on: past the two-hour time to live.
    const later = new Date(Date.now() + 3 * 60 * 60 * 1000);
    await sweepDemoSessions({ now: later });

    expect(liveDemoCount()).toBe(0);
    // The group has to go explicitly — groups.created_by_user_id is ON DELETE
    // SET NULL, so deleting the user alone would leave it orphaned rather than
    // gone, and the memory it occupies is the whole cost of a demo instance.
    await expect(authorizeGroup(demo.user, group.id)).rejects.toThrow();
  }, 60_000);
});
