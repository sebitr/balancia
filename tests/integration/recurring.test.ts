import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, recurringOccurrences } from "@/lib/db/schema";
import { AuthorizationError } from "@/lib/security/authorization";
import {
  createRecurringExpense,
  deleteRecurringExpense,
  generateDueOccurrences,
  listRecurringExpenses,
  restoreRecurringExpense,
  setRecurringPaused,
} from "@/modules/recurring/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Recurring generation, with idempotency as the headline property.
 *
 * "Running the worker twice must never create duplicate expenses" is the
 * requirement; these tests run it twice, and concurrently, and check the count.
 */

async function setupTemplate(options: { timezone?: string } = {}) {
  const actor = await createTestUser();
  const group = await createTestGroup(actor, {
    timezone: options.timezone ?? "UTC",
  });
  const other = await addTestParticipant(group.groupId, "Blaise");

  const templateId = await createRecurringExpense(group.access, {
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
      { participantId: other },
    ],
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 1,
    startDate: isoToday(-70),
    endDate: "",
  });

  return { actor, group, other, templateId };
}

describe("recurring generation", () => {
  it("creates the expenses that are due", async () => {
    const { group, templateId } = await setupTemplate();

    const report = await generateDueOccurrences({ groupId: group.groupId });
    expect(report.expensesCreated).toBeGreaterThan(0);

    const db = getDb();
    const generated = await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));

    expect(generated.length).toBe(report.expensesCreated);
    for (const expense of generated) {
      expect(expense.amount).toBe(120000n);
      expect(expense.createdByActorType).toBe("system");
      // Both halves travel, or a monthly "Loyer" arrives as bare `home`.
      expect(expense.category).toBe("home");
      expect(expense.subcategory).toBe("rent");
    }
  });

  it("is idempotent: running twice creates nothing extra", async () => {
    const { group, templateId } = await setupTemplate();

    const first = await generateDueOccurrences({ groupId: group.groupId });
    const second = await generateDueOccurrences({ groupId: group.groupId });

    expect(first.expensesCreated).toBeGreaterThan(0);
    expect(second.expensesCreated).toBe(0);

    const db = getDb();
    const generated = await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));
    expect(generated).toHaveLength(first.expensesCreated);
  });

  it("is idempotent under concurrent workers", async () => {
    const { group, templateId } = await setupTemplate();

    // Two workers racing on the same due dates.
    const [a, b] = await Promise.all([
      generateDueOccurrences({ groupId: group.groupId }),
      generateDueOccurrences({ groupId: group.groupId }),
    ]);

    const db = getDb();
    const generated = await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));
    const occurrences = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.recurringExpenseId, templateId));

    // Exactly one expense per occurrence date, no matter who won the race.
    expect(generated.length).toBe(occurrences.length);
    expect(a.expensesCreated + b.expensesCreated).toBe(generated.length);

    const dates = occurrences.map((row) => row.occurrenceDate);
    expect(new Set(dates).size).toBe(dates.length);
  });

  it("links each occurrence to the expense it produced", async () => {
    const { group, templateId } = await setupTemplate();
    await generateDueOccurrences({ groupId: group.groupId });

    const db = getDb();
    const occurrences = await db
      .select()
      .from(recurringOccurrences)
      .where(eq(recurringOccurrences.recurringExpenseId, templateId));

    expect(occurrences.length).toBeGreaterThan(0);
    for (const occurrence of occurrences) {
      expect(occurrence.expenseId).not.toBeNull();
    }
  });

  it("generates nothing while paused", async () => {
    const { group, templateId } = await setupTemplate();
    await setRecurringPaused(group.access, templateId, true);

    const report = await generateDueOccurrences({ groupId: group.groupId });
    expect(report.expensesCreated).toBe(0);

    const db = getDb();
    const generated = await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));
    expect(generated).toHaveLength(0);
  });

  it("resumes from where it left off rather than regenerating history", async () => {
    const { group, templateId } = await setupTemplate();
    const first = await generateDueOccurrences({ groupId: group.groupId });

    // Pause, resume, run again: still nothing new until the next due date.
    await setRecurringPaused(group.access, templateId, true);
    await setRecurringPaused(group.access, templateId, false);
    const second = await generateDueOccurrences({ groupId: group.groupId });

    expect(second.expensesCreated).toBe(0);

    const db = getDb();
    const generated = await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));
    expect(generated).toHaveLength(first.expensesCreated);
  });

  it("writes an activity event attributed to the system", async () => {
    const { group } = await setupTemplate();
    await generateDueOccurrences({ groupId: group.groupId });

    const db = getDb();
    const events = await db.query.activityEvents.findMany({
      where: (table, { and, eq: equals }) =>
        and(
          equals(table.groupId, group.groupId),
          equals(table.action, "recurring.generated"),
        ),
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0].actorType).toBe("system");
  });

  it("honours the group's timezone when deciding what is due", async () => {
    // A template in a far-future timezone should not fire before its local date.
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      timezone: "Pacific/Auckland",
    });
    const other = await addTestParticipant(group.groupId, "Blaise");

    await createRecurringExpense(group.access, {
      description: "Future rent",
      notes: "",
      category: "",
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      payers: [{ participantId: group.ownerParticipantId, amount: "1000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: other },
      ],
      frequency: "monthly",
      interval: 1,
      dayOfMonth: 1,
      // Starts well in the future: nothing is due yet.
      startDate: isoToday(60),
      endDate: "",
    });

    const report = await generateDueOccurrences({ groupId: group.groupId });
    expect(report.expensesCreated).toBe(0);
  });
});

/**
 * Undo behind the removal toast.
 *
 * A template is only really back if the worker starts looking at it again, so
 * that — and not the row's flag — is what these check.
 */
describe("restoring a removed template", () => {
  it("puts the template back in the group's list", async () => {
    const { group, templateId } = await setupTemplate();

    await deleteRecurringExpense(group.access, templateId);
    expect(await listRecurringExpenses(group.groupId)).toHaveLength(0);

    await restoreRecurringExpense(group.access, templateId);
    const listed = await listRecurringExpenses(group.groupId);
    expect(listed.map((template) => template.id)).toEqual([templateId]);
  });

  /**
   * Removal clears `next_run_at`, and the restore deliberately leaves it
   * clear: a null marker is how the worker is told to work the date out for
   * itself. What must not happen is a template that comes back and then never
   * fires again.
   */
  it("generates again once it is back, without repeating what it already made", async () => {
    const { group, templateId } = await setupTemplate();
    const first = await generateDueOccurrences({ groupId: group.groupId });
    expect(first.expensesCreated).toBeGreaterThan(0);

    await deleteRecurringExpense(group.access, templateId);
    const whileGone = await generateDueOccurrences({ groupId: group.groupId });
    expect(whileGone.templatesProcessed).toBe(0);

    await restoreRecurringExpense(group.access, templateId);
    const after = await generateDueOccurrences({ groupId: group.groupId });

    // Looked at again, and with nothing new to make: the occurrences it
    // already recorded still say which dates are spoken for.
    expect(after.templatesProcessed).toBe(1);
    expect(after.expensesCreated).toBe(0);

    const db = getDb();
    const generated = await db
      .select()
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));
    expect(generated).toHaveLength(first.expensesCreated);
  });

  it("records the removal and the restore against the template", async () => {
    const { group, templateId } = await setupTemplate();

    await deleteRecurringExpense(group.access, templateId);
    await restoreRecurringExpense(group.access, templateId);

    const db = getDb();
    const events = await db.query.activityEvents.findMany({
      where: (table, { and, eq: equals }) =>
        and(
          equals(table.groupId, group.groupId),
          equals(table.entityId, templateId),
        ),
      orderBy: (table, { asc }) => asc(table.createdAt),
    });

    expect(events.map((event) => event.action)).toEqual([
      "recurring.created",
      "recurring.deleted",
      "recurring.restored",
    ]);
  });

  /** The guard that makes the Undo safe to press twice. */
  it("refuses to restore a template that is not deleted", async () => {
    const { group, templateId } = await setupTemplate();

    await expect(
      restoreRecurringExpense(group.access, templateId),
    ).rejects.toThrow(AuthorizationError);
  });
});
