import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { activityEvents, expenseShares, expenses } from "@/lib/db/schema";
import { AuthorizationError } from "@/lib/security/authorization";
import {
  createExpense,
  deleteExpense,
  listExpenses,
} from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
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
