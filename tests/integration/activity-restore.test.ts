import { drizzle } from "drizzle-orm/node-postgres";
import { describe, expect, it } from "vitest";
import { getPool, schema, type Database } from "@/lib/db/client";
import type { GroupAccess } from "@/lib/security/authorization";
import {
  findRestorableDeletions,
  listGroupActivity,
  type ActivityEntry,
} from "@/modules/activity/service";
import {
  createExpense,
  deleteExpense,
  restoreExpense,
} from "@/modules/expenses/service";
import {
  createSettlement,
  deleteSettlement,
} from "@/modules/settlements/service";
import {
  createRecurringExpense,
  deleteRecurringExpense,
} from "@/modules/recurring/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * The Activity screen's Restore, at the point where the page decides which
 * rows get one.
 *
 * The button itself is only the restore every deletion already had. What is
 * new, and what can go wrong, is the choosing: a row offered for something
 * that is back already, a row offered twice for one thing, or a page that asks
 * the database once per row to find out.
 */

/** A client that counts the statements it sends, and nothing else. */
function countingDb(): { db: Database; statements: () => number } {
  let statements = 0;
  const db = drizzle(getPool(), {
    schema,
    casing: "snake_case",
    logger: {
      logQuery: () => {
        statements += 1;
      },
    },
  });
  return { db, statements: () => statements };
}

async function setup() {
  const actor = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(actor);
  const blaise = await addTestParticipant(group.groupId, "Blaise");

  const expense = (description: string) =>
    createExpense(group.access, {
      description,
      notes: "",
      category: "",
      amount: "3000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: group.ownerParticipantId, amount: "3000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
    });

  const settlement = () =>
    createSettlement(group.access, {
      fromParticipantId: blaise,
      toParticipantId: group.ownerParticipantId,
      amount: "1500",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

  const template = () =>
    createRecurringExpense(group.access, {
      description: "Rent",
      notes: "",
      category: "home",
      subcategory: "rent",
      amount: "120000",
      currency: "EUR",
      exchangeRate: "",
      payers: [{ participantId: group.ownerParticipantId, amount: "120000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: blaise },
      ],
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 1,
      startDate: isoToday(-70),
      endDate: "",
    });

  return { group, blaise, expense, settlement, template };
}

/** The ids of the deletion rows naming `entityId`, newest first. */
function deletionsOf(
  entries: readonly ActivityEntry[],
  entityId: string,
): string[] {
  return entries
    .filter(
      (entry) =>
        entry.entityId === entityId && entry.action.endsWith(".deleted"),
    )
    .map((entry) => entry.id);
}

describe("which deletions the Activity screen offers to restore", () => {
  it("marks the deletions still standing, across all three kinds, in one query", async () => {
    const { group, expense, settlement, template } = await setup();

    const lost = await expense("Dinner");
    await deleteExpense(group.access, lost);

    const undone = await expense("Taxi");
    await deleteExpense(group.access, undone);
    await restoreExpense(group.access, undone);

    const repayment = await settlement();
    await deleteSettlement(group.access, repayment);

    const rent = await template();
    await deleteRecurringExpense(group.access, rent);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const { db, statements } = countingDb();
    const restorable = await findRestorableDeletions(group.access, entries, {
      db,
    });

    expect(restorable).toEqual(
      new Set([
        ...deletionsOf(entries, lost),
        ...deletionsOf(entries, repayment),
        ...deletionsOf(entries, rent),
      ]),
    );
    // The one that was put back is not offered again.
    expect(deletionsOf(entries, undone)).toHaveLength(1);
    expect(restorable.has(deletionsOf(entries, undone)[0]!)).toBe(false);
    // However many rows, one round trip.
    expect(statements()).toBe(1);
  });

  it("offers something deleted twice on its latest deletion only", async () => {
    const { group, expense } = await setup();

    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    await restoreExpense(group.access, dinner);
    await deleteExpense(group.access, dinner);

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const [latest, earlier] = deletionsOf(entries, dinner);

    const restorable = await findRestorableDeletions(group.access, entries);

    expect(restorable).toEqual(new Set([latest]));
    expect(restorable.has(earlier!)).toBe(false);
  });

  it("does not offer back an expense that was turned into a repayment", async () => {
    const { group, expense, settlement } = await setup();

    // What `convertExpenseToSettlementAction` does: the repayment first, then
    // the expense it replaces, marked as replaced.
    const dinner = await expense("Dinner");
    const repayment = await settlement();
    await deleteExpense(group.access, dinner, { replacedBy: repayment });

    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    expect(await findRestorableDeletions(group.access, entries)).toEqual(
      new Set(),
    );
  });

  it("offers nothing in an archived group, and asks nothing to find that out", async () => {
    const { group, expense } = await setup();
    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    // Every restore refuses an archived group; the button would only fail.
    const archived: GroupAccess = {
      ...group.access,
      group: { ...group.access.group, archivedAt: new Date() },
    };
    const { db, statements } = countingDb();

    expect(await findRestorableDeletions(archived, entries, { db })).toEqual(
      new Set(),
    );
    expect(statements()).toBe(0);
  });

  it("offers nothing the reader's role could not restore", async () => {
    const { group, expense, settlement } = await setup();
    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    const repayment = await settlement();
    await deleteSettlement(group.access, repayment);
    const entries = await listGroupActivity(group.groupId, { limit: 100 });

    // No role lacks this today — guests included — so the access is made up.
    // The rule is that the screen asks what `restoreExpense` will ask.
    const cannotEdit: GroupAccess = {
      ...group.access,
      permissions: { ...group.access.permissions, editAnyExpense: false },
    };

    expect(await findRestorableDeletions(cannotEdit, entries)).toEqual(
      new Set(deletionsOf(entries, repayment)),
    );
  });

  it("sends no query for a page with no deletions on it", async () => {
    const { group, expense } = await setup();
    await expense("Dinner");
    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const { db, statements } = countingDb();

    expect(
      await findRestorableDeletions(group.access, entries, { db }),
    ).toEqual(new Set());
    expect(statements()).toBe(0);
  });

  it("does not reach into another group's entries", async () => {
    const { group, expense } = await setup();
    const dinner = await expense("Dinner");
    await deleteExpense(group.access, dinner);
    const theirs = await listGroupActivity(group.groupId, { limit: 100 });

    // The same rows, asked about by somebody else's group. The events are
    // filtered to the reader's group before anything is joined, so another
    // group's history cannot be used to learn what is deleted in this one.
    const other = await createTestGroup(await createTestUser());
    expect(await findRestorableDeletions(other.access, theirs)).toEqual(
      new Set(),
    );
  });
});
