import { describe, expect, it } from "vitest";
import { getPool } from "@/lib/db/client";
import { authorizeGroup } from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import { createGroup, listParticipants } from "@/modules/groups/service";
import { createSettlement } from "@/modules/settlements/service";
import { createTestUser, isoToday } from "../../../tests/helpers/factories";
import { loadHomeOverview } from "./overview";

/**
 * The home screen's read model, end to end against PostgreSQL.
 *
 * The parts worth exercising here are the ones derived rather than stored: who
 * the user owes, which bucket a group lands in, and whether the "nothing
 * outstanding" footnote can date itself. None of that is visible to a unit
 * test with hand-built positions.
 */

const BASE = {
  description: "",
  currencyMode: "separate" as const,
  timezone: "UTC",
};

/** Amélie pays, and the cost is split — so everyone else ends up owing her. */
async function groupWhereOwed(
  actor: Awaited<ReturnType<typeof createTestUser>>,
  name: string,
  others: string[],
  /** Minor units. */
  amount: string,
) {
  const created = await createGroup(actor, {
    ...BASE,
    name,
    ownerDisplayName: "Amélie",
    participantNames: others,
  });
  const access = await authorizeGroup(actor, created.id);
  const people = await listParticipants(created.id);

  await createExpense(access, {
    description: "Dinner",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: created.participantId, amount }],
    splitMethod: "equal",
    splitEntries: people.map((person) => ({ participantId: person.id })),
  });

  return { created, people, access };
}

/** The mirror image: someone else pays, so Amélie owes them. */
async function groupWhereOwing(
  actor: Awaited<ReturnType<typeof createTestUser>>,
  name: string,
  others: string[],
  /** Minor units. */
  amount: string,
) {
  const created = await createGroup(actor, {
    ...BASE,
    name,
    ownerDisplayName: "Amélie",
    participantNames: others,
  });
  const access = await authorizeGroup(actor, created.id);
  const people = await listParticipants(created.id);
  const payer = people.find((person) => person.displayName === others[0]);

  await createExpense(access, {
    description: "Rent",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: payer!.id, amount }],
    splitMethod: "equal",
    splitEntries: people.map((person) => ({ participantId: person.id })),
  });

  return { created, people, access };
}

describe("loadHomeOverview", () => {
  it("puts a group the user owes in under Needs you, largest debt first", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    await groupWhereOwing(actor, "Small", ["Mika"], "2000");
    await groupWhereOwing(actor, "Large", ["Mika"], "20000");

    const overview = await loadHomeOverview(actor.userId);

    expect(overview.buckets.needsYou.map((p) => p.group.name)).toEqual([
      "Large",
      "Small",
    ]);
    expect(overview.buckets.youAreOwed).toHaveLength(0);
  });

  it("names the single person the user owes", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    await groupWhereOwing(actor, "Flatshare", ["Mika"], "20000");

    const [position] = (await loadHomeOverview(actor.userId)).buckets.needsYou;

    expect(position.owedTo).toEqual({ kind: "single", name: "Mika" });
  });

  /*
   * `simplifyDebts` exists to minimise transfers, so most multi-person groups
   * still leave the user with one person to pay — which is why the clarifier
   * names somebody far more often than it counts them. Reaching "several"
   * takes a debt no single creditor is owed enough to absorb: here Amélie owes
   * three people 1.00 each, and no pairing can merge them.
   */
  it("counts them instead when no single payment can clear the debt", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const created = await createGroup(actor, {
      ...BASE,
      name: "Office lunches",
      ownerDisplayName: "Amélie",
      participantNames: ["Mika", "Jonas", "Ravi"],
    });
    const access = await authorizeGroup(actor, created.id);
    const people = await listParticipants(created.id);

    for (const name of ["Mika", "Jonas", "Ravi"]) {
      const payer = people.find((person) => person.displayName === name);
      await createExpense(access, {
        description: `Lunch with ${name}`,
        notes: "",
        category: "",
        amount: "200",
        currency: "EUR",
        exchangeRate: "",
        expenseDate: isoToday(),
        payers: [{ participantId: payer!.id, amount: "200" }],
        splitMethod: "equal",
        // Shared with Amélie alone, so each lunch leaves its payer 1.00 up.
        splitEntries: [
          { participantId: created.participantId },
          { participantId: payer!.id },
        ],
      });
    }

    const overview = await loadHomeOverview(actor.userId);
    const position = overview.buckets.needsYou.find(
      (p) => p.group.id === created.id,
    );

    expect(position?.owedTo).toEqual({ kind: "several", count: 3 });
  });

  it("leaves a creditor without a counterparty to chase", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    await groupWhereOwed(actor, "Lisbon", ["Mika"], "10000");

    const [position] = (await loadHomeOverview(actor.userId)).buckets
      .youAreOwed;

    expect(position.group.name).toBe("Lisbon");
    expect(position.owedTo).toBeNull();
  });

  it("reports square everywhere, and dates it, once the debt is settled", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const { created, people, access } = await groupWhereOwing(
      actor,
      "Chalet",
      ["Mika"],
      "10000",
    );
    const mika = people.find((person) => person.displayName === "Mika");

    await createSettlement(access, {
      fromParticipantId: created.participantId,
      toParticipantId: mika!.id,
      amount: "5000",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

    const overview = await loadHomeOverview(actor.userId);

    expect(overview.buckets.needsYou).toHaveLength(0);
    expect(overview.buckets.youAreOwed).toHaveLength(0);
    expect(overview.buckets.settled.map((p) => p.group.name)).toEqual([
      "Chalet",
    ]);
    // The footnote can only say "last cleared … in Chalet" if this is here.
    expect(overview.lastCleared?.groupName).toBe("Chalet");
  });

  it("has nothing to date when the user has never settled anything", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    await createGroup(actor, {
      ...BASE,
      name: "Brand new",
      ownerDisplayName: "Amélie",
    });

    const overview = await loadHomeOverview(actor.userId);

    expect(overview.buckets.settled).toHaveLength(1);
    expect(overview.lastCleared).toBeNull();
  });

  /**
   * The home screen must not get more expensive per group.
   *
   * It used to: the balances were loaded one group at a time, five queries
   * each, so somebody in a dozen groups paid sixty-one round trips for a
   * screen that is dynamic and renders on every visit. Counting is the only
   * way to state that, because the result is identical either way — the bug
   * was never visible in an assertion about balances, only in the clock.
   */
  it("costs the same number of queries however many groups there are", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    await groupWhereOwing(actor, "First", ["Mika"], "1000");

    const pool = getPool();
    const original = pool.query.bind(pool);
    let queries = 0;
    const counting = ((...args: Parameters<typeof original>) => {
      queries += 1;
      return original(...args);
    }) as typeof pool.query;

    pool.query = counting;
    try {
      await loadHomeOverview(actor.userId);
      const withOneGroup = queries;

      pool.query = original;
      await groupWhereOwing(actor, "Second", ["Jonas"], "2000");
      await groupWhereOwing(actor, "Third", ["Ravi"], "3000");
      await groupWhereOwed(actor, "Fourth", ["Sam"], "4000");

      queries = 0;
      pool.query = counting;
      await loadHomeOverview(actor.userId);
      const withFourGroups = queries;

      // Guards the guard: if the counter ever stopped seeing the queries —
      // a driver that pooled differently, a mock left in place — both numbers
      // would be zero and this test would pass while measuring nothing.
      expect(withOneGroup).toBeGreaterThan(0);
      expect(withFourGroups).toBe(withOneGroup);
    } finally {
      pool.query = original;
    }
  });
});
