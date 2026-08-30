import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { decodeCursor, encodeCursor, type ListCursor } from "@/lib/db/keyset";
import { activityEvents, expenseShares, expenses } from "@/lib/db/schema";
import { AuthorizationError } from "@/lib/security/authorization";
import {
  createExpense,
  deleteExpense,
  listExpenses,
  restoreExpense,
  updateExpense,
} from "@/modules/expenses/service";
import {
  createSettlement,
  deleteSettlement,
  listSettlements,
  restoreSettlement,
} from "@/modules/settlements/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { balancesSumToZero } from "@/modules/balances/engine";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Expense and settlement integration tests against real PostgreSQL.
 *
 * These verify the things a unit test cannot: that a write and its activity
 * event land in the same transaction, that constraints hold, and that a
 * failure leaves nothing behind.
 */

describe("expense creation", () => {
  it("writes the expense, its payers, its shares and an activity event together", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    const expenseId = await createExpense(group.access, {
      description: "Dinner",
      notes: "",
      category: "Food",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: other },
      ],
    });

    const db = getDb();
    const [row] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, expenseId));
    expect(row.amount).toBe(3000n);
    expect(row.currency).toBe("EUR");
    expect(row.splitMethod).toBe("equal");

    const shares = await db
      .select()
      .from(expenseShares)
      .where(eq(expenseShares.expenseId, expenseId));
    expect(shares).toHaveLength(2);
    expect(shares.reduce((sum, share) => sum + share.amount, 0n)).toBe(3000n);

    const events = await db
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.groupId, group.groupId),
          eq(activityEvents.action, "expense.created"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0].entityId).toBe(expenseId);
    expect(events[0].actorType).toBe("user");
  });

  it("rolls the whole thing back when the split is invalid", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");

    await expect(
      createExpense(group.access, {
        description: "Broken",
        notes: "",
        category: "",
        amount: "3000",
        currency: "EUR",
        exchangeRate: "",
        expenseDate: isoToday(),
        payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
        splitMethod: "exact",
        splitEntries: [
          { participantId: group.ownerParticipantId, value: "1000" },
          { participantId: other, value: "1000" },
        ],
      }),
    ).rejects.toThrow(/sum to the expense total/);

    const db = getDb();
    const rows = await db
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(rows).toHaveLength(0);

    // No orphan activity event either.
    const events = await db
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.groupId, group.groupId));
    expect(events).toHaveLength(0);
  });

  it("refuses to attach a participant from another group", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { name: "Mine" });
    const otherGroup = await createTestGroup(actor, { name: "Theirs" });
    const stranger = await addTestParticipant(otherGroup.groupId, "Stranger");

    await expect(
      createExpense(group.access, {
        description: "Sneaky",
        notes: "",
        category: "",
        amount: "1000",
        currency: "EUR",
        exchangeRate: "",
        expenseDate: isoToday(),
        payers: [{ participantId: group.ownerParticipantId, amount: "1000" }],
        splitMethod: "equal",
        splitEntries: [
          { participantId: group.ownerParticipantId },
          { participantId: stranger },
        ],
      }),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("multi-payer expenses", () => {
  it("records several payers and balances them correctly", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");
    const grace = await addTestParticipant(group.groupId, "Grace");

    await createExpense(group.access, {
      description: "Boat",
      notes: "",
      category: "",
      amount: "9000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [
        { participantId: group.ownerParticipantId, amount: "6000" },
        { participantId: grace, amount: "3000" },
      ],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
        { participantId: grace },
      ],
    });

    const balances = await loadGroupBalances(group.access);
    const eur = balances.currencies.find((entry) => entry.currency === "EUR")!;
    const byId = Object.fromEntries(
      eur.balances.map((balance) => [balance.participantId, balance.amount]),
    );

    // Owner paid 6000, owes 3000 → +3000. Grace paid 3000, owes 3000 → 0.
    // Blaise paid nothing, owes 3000 → -3000.
    expect(byId[group.ownerParticipantId]).toBe(3000n);
    expect(byId[grace]).toBe(0n);
    expect(byId[blaise]).toBe(-3000n);
    expect(balancesSumToZero(eur.balances)).toBe(true);
  });
});

describe("converted-currency groups", () => {
  it("freezes the exchange rate and balances in the base currency", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    const expenseId = await createExpense(group.access, {
      description: "Duty free",
      notes: "",
      category: "",
      amount: "11000",
      currency: "USD",
      exchangeRate: "0.92",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "11000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    const db = getDb();
    const [row] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, expenseId));

    expect(row.amount).toBe(11000n);
    expect(row.currency).toBe("USD");
    expect(row.convertedAmount).toBe(10120n);
    expect(row.convertedCurrency).toBe("EUR");
    expect(Number(row.exchangeRate)).toBeCloseTo(0.92, 10);
    expect(row.exchangeRateSource).toBe("manual");
    expect(row.exchangeRateAt).not.toBeNull();

    const balances = await loadGroupBalances(group.access);
    expect(balances.currencies).toHaveLength(1);
    expect(balances.currencies[0].currency).toBe("EUR");
    const byId = Object.fromEntries(
      balances.currencies[0].balances.map((balance) => [
        balance.participantId,
        balance.amount,
      ]),
    );
    expect(byId[group.ownerParticipantId]).toBe(5060n);
    expect(byId[blaise]).toBe(-5060n);
  });

  it("requires an exchange rate for a foreign currency", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });

    await expect(
      createExpense(group.access, {
        description: "No rate",
        notes: "",
        category: "",
        amount: "1000",
        currency: "USD",
        exchangeRate: "",
        expenseDate: isoToday(),
        payers: [{ participantId: group.ownerParticipantId, amount: "1000" }],
        splitMethod: "equal",
        splitEntries: [{ participantId: group.ownerParticipantId }],
      }),
    ).rejects.toThrow(/exchange rate is required/);
  });
});

describe("separate-currency groups", () => {
  it("keeps a balance per currency", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { currencyMode: "separate" });
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    for (const [currency, amount] of [
      ["EUR", "1000"],
      ["JPY", "2000"],
    ] as const) {
      await createExpense(group.access, {
        description: `Spend in ${currency}`,
        notes: "",
        category: "",
        amount,
        currency,
        exchangeRate: "",
        expenseDate: isoToday(),
        payers: [{ participantId: group.ownerParticipantId, amount }],
        splitMethod: "equal",
        splitEntries: [
          { participantId: group.ownerParticipantId },
          { participantId: blaise },
        ],
      });
    }

    const balances = await loadGroupBalances(group.access);
    expect(balances.currencies.map((entry) => entry.currency)).toEqual([
      "EUR",
      "JPY",
    ]);
    for (const entry of balances.currencies) {
      expect(balancesSumToZero(entry.balances)).toBe(true);
    }
  });
});

describe("settlements", () => {
  it("moves balances without counting as spending", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      description: "Lunch",
      notes: "",
      category: "",
      amount: "2000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "2000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    const before = await loadGroupBalances(group.access);
    expect(before.totalSpend.get("EUR")).toBe(2000n);

    await createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "Paid back",
    });

    const after = await loadGroupBalances(group.access);
    const eur = after.currencies.find((entry) => entry.currency === "EUR")!;
    expect(eur.balances.every((balance) => balance.amount === 0n)).toBe(true);
    // The settlement did not inflate spending.
    expect(after.totalSpend.get("EUR")).toBe(2000n);
  });
});

describe("soft deletion", () => {
  it("excludes a deleted expense from balances and listings", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    const expenseId = await createExpense(group.access, {
      description: "Mistake",
      notes: "",
      category: "",
      amount: "5000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "5000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    await deleteExpense(group.access, expenseId);

    expect(await listExpenses(group.groupId)).toHaveLength(0);

    const balances = await loadGroupBalances(group.access);
    for (const entry of balances.currencies) {
      expect(entry.balances.every((balance) => balance.amount === 0n)).toBe(
        true,
      );
    }

    // The row is still there — deletion is soft, so history survives.
    const db = getDb();
    const [row] = await db
      .select()
      .from(expenses)
      .where(eq(expenses.id, expenseId));
    expect(row.deletedAt).not.toBeNull();
  });
});

/**
 * Undo, from the server's side.
 *
 * The toast's Undo is only honest if a restore really does put the group back
 * where it was, so what is checked here is the group and not the row: the
 * expense in its listing, the balances to the cent, and the trail saying both
 * things happened.
 */
describe("restoring what was deleted", () => {
  async function groupWithExpense() {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    const expenseId = await createExpense(group.access, {
      description: "Dinner",
      notes: "",
      category: "",
      amount: "5000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "5000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

    return { group, blaise, expenseId };
  }

  it("puts an expense back in the listing and the balances", async () => {
    const { group, expenseId } = await groupWithExpense();
    const before = await loadGroupBalances(group.access);

    await deleteExpense(group.access, expenseId);
    await restoreExpense(group.access, expenseId);

    expect(await listExpenses(group.groupId)).toHaveLength(1);

    // The shares were never touched, so the balances come back identical
    // rather than merely close.
    const after = await loadGroupBalances(group.access);
    expect(after.totalSpend.get("EUR")).toBe(before.totalSpend.get("EUR"));
    for (const entry of after.currencies) {
      const was = before.currencies.find(
        (candidate) => candidate.currency === entry.currency,
      )!;
      expect(entry.balances).toEqual(was.balances);
    }
  });

  it("records the deletion and the restore, in that order", async () => {
    const { group, expenseId } = await groupWithExpense();

    await deleteExpense(group.access, expenseId);
    await restoreExpense(group.access, expenseId);

    const db = getDb();
    const events = await db
      .select({ action: activityEvents.action })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.groupId, group.groupId),
          eq(activityEvents.entityId, expenseId),
        ),
      )
      .orderBy(activityEvents.createdAt);

    expect(events.map((event) => event.action)).toEqual([
      "expense.created",
      "expense.deleted",
      "expense.restored",
    ]);
  });

  /**
   * The guard that makes Undo safe to press twice. A restore only ever clears
   * a deletion, so a second one — a double tap, a request the network sent
   * again — finds nothing to clear and refuses rather than writing a second
   * event about an expense that never left.
   */
  it("refuses to restore an expense that is not deleted", async () => {
    const { group, expenseId } = await groupWithExpense();

    await expect(restoreExpense(group.access, expenseId)).rejects.toThrow(
      AuthorizationError,
    );

    await deleteExpense(group.access, expenseId);
    await restoreExpense(group.access, expenseId);
    await expect(restoreExpense(group.access, expenseId)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("will not restore an expense belonging to another group", async () => {
    const { group, expenseId } = await groupWithExpense();
    await deleteExpense(group.access, expenseId);

    const stranger = await createTestUser();
    const theirGroup = await createTestGroup(stranger);

    await expect(restoreExpense(theirGroup.access, expenseId)).rejects.toThrow(
      AuthorizationError,
    );

    // And it is still deleted, not quietly resurrected into the wrong group.
    expect(await listExpenses(group.groupId)).toHaveLength(0);
  });

  it("puts a repayment back on both sides of it", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    await createExpense(group.access, {
      description: "Dinner",
      notes: "",
      category: "",
      amount: "2000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "2000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });
    const settlementId = await createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "Paid back",
    });

    await deleteSettlement(group.access, settlementId);
    // Deleted, the repayment stops squaring them.
    const owing = await loadGroupBalances(group.access);
    expect(
      owing.currencies
        .find((entry) => entry.currency === "EUR")!
        .balances.every((balance) => balance.amount === 0n),
    ).toBe(false);

    await restoreSettlement(group.access, settlementId);

    expect(await listSettlements(group.groupId)).toHaveLength(1);
    const square = await loadGroupBalances(group.access);
    expect(
      square.currencies
        .find((entry) => entry.currency === "EUR")!
        .balances.every((balance) => balance.amount === 0n),
    ).toBe(true);
    // A repayment is not spending, restored any more than created.
    expect(square.totalSpend.get("EUR")).toBe(2000n);
  });

  it("refuses to restore a repayment that is not deleted", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const blaise = await addTestParticipant(group.groupId, "Blaise");

    const settlementId = await createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

    await expect(restoreSettlement(group.access, settlementId)).rejects.toThrow(
      AuthorizationError,
    );
  });
});

describe("paging a long list", () => {
  /**
   * Rows written in one statement, which is what an import does.
   *
   * They therefore share a `created_at` to the microsecond — Postgres' `now()`
   * is the transaction's clock, not the statement's — and several share a
   * date. That is the arrangement keyset paging has to survive, and the one
   * `LIMIT`/`OFFSET` cannot: with nothing left to break the tie, the database
   * is free to return them in a different order per query, and a page boundary
   * then lands somewhere different each time.
   */
  async function fillGroup(groupId: string, count: number): Promise<void> {
    const db = getDb();
    await db.insert(expenses).values(
      Array.from({ length: count }, (_, index) => ({
        groupId,
        description: `Row ${index}`,
        amount: 1000n,
        currency: "EUR",
        splitMethod: "equal" as const,
        // Two dates only, so most of the list ties on both date and clock and
        // is separated by nothing but the id.
        expenseDate: index < count / 2 ? "2019-07-02" : "2022-03-04",
        createdByActorType: "user" as const,
      })),
    );
  }

  /** Walks the whole list a page at a time, as the screen does. */
  async function pageThrough(groupId: string, size: number): Promise<string[]> {
    const seen: string[] = [];
    let cursor: ListCursor | null = null;

    for (;;) {
      const page = await listExpenses(groupId, { limit: size, before: cursor });
      seen.push(...page.map((expense) => expense.id));
      if (page.length < size) return seen;

      const last = page[page.length - 1];
      // Through the wire format, not around it: an encoding that cannot carry
      // the key exactly is the failure this is looking for.
      cursor = decodeCursor(
        encodeCursor({
          date: last.expenseDate,
          time: last.cursorKey,
          id: last.id,
        }),
      );
      expect(cursor).not.toBeNull();
    }
  }

  it("hands out every row exactly once, in the order one query would", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    await fillGroup(group.groupId, 25);

    const whole = await listExpenses(group.groupId, { limit: 1000 });
    const paged = await pageThrough(group.groupId, 7);

    expect(paged).toHaveLength(25);
    expect(new Set(paged).size).toBe(25);
    expect(paged).toEqual(whole.map((expense) => expense.id));
  });

  it("ends on the boundary rather than one page past it", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    await fillGroup(group.groupId, 20);

    // A page size that divides the list exactly is where an off-by-one shows
    // up: the last full page must still be followed by an empty one.
    expect(await pageThrough(group.groupId, 10)).toHaveLength(20);
  });

  it("carries a microsecond clock through the cursor without rounding it", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const db = getDb();

    // Same date, same millisecond, different microseconds — a cursor that went
    // through a JavaScript Date would round down and skip the second row.
    await db.insert(expenses).values(
      [".123456", ".123999"].map((fraction, index) => ({
        groupId: group.groupId,
        description: `Row ${index}`,
        amount: 1000n,
        currency: "EUR",
        splitMethod: "equal" as const,
        expenseDate: "2019-07-02",
        createdByActorType: "user" as const,
        createdAt: new Date(`2019-07-02T10:00:00${fraction}Z`),
      })),
    );

    // Written as text so the microseconds survive the driver as well.
    await db.execute(sql`
      UPDATE ${expenses}
      SET created_at = '2019-07-02 10:00:00.123456+00'
      WHERE ${expenses.description} = 'Row 0'
    `);
    await db.execute(sql`
      UPDATE ${expenses}
      SET created_at = '2019-07-02 10:00:00.123999+00'
      WHERE ${expenses.description} = 'Row 1'
    `);

    expect(await pageThrough(group.groupId, 1)).toHaveLength(2);
  });
});

describe("the category and subcategory pair", () => {
  /**
   * The column is plain nullable text, so the guarantee that a pair is
   * coherent is the service layer's, not the database's. These check it holds
   * where it actually matters: on the way in, and on the way back out.
   */
  const base = (group: Awaited<ReturnType<typeof createTestGroup>>) => ({
    description: "Electricity August",
    notes: "",
    amount: "8700",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "8700" }],
    splitMethod: "equal" as const,
    splitEntries: [{ participantId: group.ownerParticipantId }],
  });

  it("stores both halves, and hands them back", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const expenseId = await createExpense(group.access, {
      ...base(group),
      category: "home",
      subcategory: "electricity",
    });

    const [row] = await getDb()
      .select({
        category: expenses.category,
        subcategory: expenses.subcategory,
      })
      .from(expenses)
      .where(eq(expenses.id, expenseId));

    // Stable IDs, never the translated labels a French reader would see.
    expect(row).toEqual({ category: "home", subcategory: "electricity" });
  });

  it("accepts a category with no subcategory at all", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const expenseId = await createExpense(group.access, {
      ...base(group),
      category: "home",
    });

    const [row] = await getDb()
      .select({ subcategory: expenses.subcategory })
      .from(expenses)
      .where(eq(expenses.id, expenseId));

    // Complete, not half-entered.
    expect(row.subcategory).toBeNull();
  });

  /*
   * A mismatched pair is refused by `expenseInputSchema`, which is where the
   * rule lives and where `schemas.test.ts` pins it down — every caller that
   * reaches this service (the actions, the API route, the recurring
   * generator) parses through it first. The test that used to sit here asked
   * the service to refuse one directly, which it never did and does not need
   * to; it only ever passed as long as nothing ran it.
   */

  it("clears the subcategory when an edit changes the category", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const expenseId = await createExpense(group.access, {
      ...base(group),
      category: "transport",
      subcategory: "fuel",
    });

    // The picker clears the child before it ever reaches here; this is the
    // same entry saved again under a different parent.
    await updateExpense(group.access, expenseId, {
      ...base(group),
      category: "restaurants",
    });

    const [row] = await getDb()
      .select({
        category: expenses.category,
        subcategory: expenses.subcategory,
      })
      .from(expenses)
      .where(eq(expenses.id, expenseId));

    expect(row).toEqual({ category: "restaurants", subcategory: null });
  });
});

/**
 * Replaying an entry that was queued offline.
 *
 * The queue's whole risk is here. A device that lost its connection mid-write
 * cannot tell a request that never arrived from one that arrived and whose
 * answer was lost, so it sends again — and if the second send writes a second
 * expense, the group's balances are wrong by the price of a dinner and nobody
 * can see why. These run against real PostgreSQL because the guarantee is a
 * unique index, and a unique index is not something a mock can be wrong about.
 */
describe("offline replay", () => {
  const dinner = (group: Awaited<ReturnType<typeof createTestGroup>>) => ({
    description: "Dinner",
    notes: "",
    category: "Food",
    amount: "3000",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
    splitMethod: "equal" as const,
    splitEntries: [{ participantId: group.ownerParticipantId }],
  });

  it("writes one expense however many times the same key arrives", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const clientKey = randomUUID();

    const first = await createExpense(group.access, dinner(group), {
      clientKey,
    });
    const second = await createExpense(group.access, dinner(group), {
      clientKey,
    });
    const third = await createExpense(group.access, dinner(group), {
      clientKey,
    });

    expect(second).toBe(first);
    expect(third).toBe(first);

    const rows = await getDb()
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(rows).toHaveLength(1);
  });

  it("leaves the balances alone on a replay", async () => {
    // The reason the count above matters. A second copy would show up here as
    // €30 that nobody spent, split between people who never agreed to it.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");
    const clientKey = randomUUID();

    const input = {
      ...dinner(group),
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: other },
      ],
    };

    await createExpense(group.access, input, { clientKey });
    const after = await loadGroupBalances(group.access);
    await createExpense(group.access, input, { clientKey });
    const afterReplay = await loadGroupBalances(group.access);

    expect(afterReplay.currencies).toEqual(after.currencies);
  });

  it("writes both when two identical expenses carry different keys", async () => {
    // The case a content hash would get wrong, and the reason the key is
    // minted by the client rather than derived from the row. Two identical
    // €3 coffees on one afternoon are two expenses.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const first = await createExpense(group.access, dinner(group), {
      clientKey: randomUUID(),
    });
    const second = await createExpense(group.access, dinner(group), {
      clientKey: randomUUID(),
    });

    expect(second).not.toBe(first);
    const rows = await getDb()
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(rows).toHaveLength(2);
  });

  it("writes one expense when two replays race each other", async () => {
    // Two tabs waking on the same reconnect. Neither sees the other's key
    // before writing, so both get past the lookup and the unique index is the
    // only thing between them and a duplicate.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const clientKey = randomUUID();

    const [first, second] = await Promise.all([
      createExpense(group.access, dinner(group), { clientKey }),
      createExpense(group.access, dinner(group), { clientKey }),
    ]);

    expect(second).toBe(first);
    const rows = await getDb()
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(rows).toHaveLength(1);
  });

  it("does not resurrect an entry that was deleted after it was written", async () => {
    // A replay arriving after somebody removed the entry. The key is spent, so
    // it answers with the id it already made and adds nothing — the deletion
    // was a decision by a person who could see what they were removing, and a
    // retry from a phone is not a reason to overturn it.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const clientKey = randomUUID();

    const expenseId = await createExpense(group.access, dinner(group), {
      clientKey,
    });
    await deleteExpense(group.access, expenseId);

    const replayed = await createExpense(group.access, dinner(group), {
      clientKey,
    });

    expect(replayed).toBe(expenseId);
    const rows = await getDb()
      .select()
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(rows).toHaveLength(1);
    expect(rows[0].deletedAt).not.toBeNull();
  });

  it("keeps one group's keys out of another's", async () => {
    // The index is on (group, key), not on the key alone: two devices are
    // free to mint the same value, and a group must never be able to swallow
    // another group's expense by colliding with it.
    const actor = await createTestUser();
    const first = await createTestGroup(actor);
    const second = await createTestGroup(actor);
    const clientKey = randomUUID();

    const a = await createExpense(first.access, dinner(first), { clientKey });
    const b = await createExpense(second.access, dinner(second), { clientKey });

    expect(b).not.toBe(a);
  });

  it("writes an ordinary expense when no key is offered at all", async () => {
    // Every caller that is not the queue — the form online, an import, the
    // recurring generator — passes nothing, and must go on behaving exactly as
    // it did before any of this existed.
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const first = await createExpense(group.access, dinner(group));
    const second = await createExpense(group.access, dinner(group));

    expect(second).not.toBe(first);
  });
});
