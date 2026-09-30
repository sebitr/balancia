import { asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  exchangeRateQuotes,
  expenses,
  participants,
  recurringExpenses,
  recurringOccurrences,
} from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  AuthorizationError,
  type UserActor,
} from "@/lib/security/authorization";
import { createApiToken } from "@/modules/api-tokens/service";
import { CurrencyConfigurationError } from "@/modules/currencies/conversion";
import { resetRatesProviderCache } from "@/modules/currencies/provider";
import { AllocationError } from "@/modules/expenses/allocation";
import { setGroupArchived } from "@/modules/groups/service";
import { occurrenceInstant } from "@/modules/recurring/schedule";
import {
  createRecurringExpense,
  deleteRecurringExpense,
  generateDueOccurrences,
  listRecurringExpenses,
  restoreRecurringExpense,
  setRecurringPaused,
  type RecurringInput,
} from "@/modules/recurring/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/*
 * The route and the Server Action are called directly further down, to check
 * that a template is refused in the same words and with the same status as
 * the one-off entry it will become. Neither has a request around it here, so
 * the cookie session, the cache and the translation lookup are stood in for;
 * nothing else in this file reaches any of them.
 */
const cookieActor = vi.hoisted(() => ({ value: null as UserActor | null }));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => cookieActor.value,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

// No catalogue: an error with no translation answers in its own English,
// which is the part both funnels are being compared on.
vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { has: () => false }),
}));

const recurringRoute =
  await import("@/app/api/groups/[groupId]/recurring/route");
const expensesRoute = await import("@/app/api/groups/[groupId]/expenses/route");
const { createRecurringAction } = await import("@/modules/recurring/actions");
const { createExpenseAction } = await import("@/modules/expenses/actions");

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
 * The hour of the day a group hears about its rent.
 *
 * `GENERATION_HOUR` is unit-tested as arithmetic, but what a person actually
 * feels is the notification, and only two things decide when that arrives: the
 * `next_run_at` the worker writes, and the dates a run is willing to generate.
 * Both are read back here, in the group's own zone, because this started as a
 * bug report about a phone going off at midnight rather than about a number.
 */
describe("the hour an occurrence is generated at", () => {
  const ZONE = "Europe/Paris";

  /** The clock the group reads, for an instant the database handed back. */
  function clockIn(instant: Date | null): string | null {
    if (!instant) return null;
    return DateTime.fromJSDate(instant).setZone(ZONE).toFormat("HH:mm");
  }

  /** A date in the group's own zone, which after 22:00 is not the UTC one. */
  function dayIn(offsetDays: number): string {
    return DateTime.now()
      .setZone(ZONE)
      .plus({ days: offsetDays })
      .toISODate() as string;
  }

  /** That day, at that hour, in the group's zone. */
  function instantAt(date: string, hour: number): Date {
    return DateTime.fromISO(date, { zone: ZONE }).set({ hour }).toJSDate();
  }

  async function dailyTemplate(startDate: string) {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { timezone: ZONE });
    const other = await addTestParticipant(group.groupId, "Blaise");

    await createRecurringExpense(group.access, {
      description: "Coffee",
      notes: "",
      category: "",
      amount: "400",
      currency: "EUR",
      exchangeRate: "",
      payers: [{ participantId: group.ownerParticipantId, amount: "400" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: group.ownerParticipantId },
        { participantId: other },
      ],
      frequency: "daily",
      interval: 1,
      startDate,
      endDate: "",
    });

    return group;
  }

  it("puts the next run at nine in the morning, not at midnight", async () => {
    const { group } = await setupTemplate({ timezone: ZONE });

    const [created] = await listRecurringExpenses(group.groupId);
    expect(clockIn(created.nextRunAt)).toBe("09:00");

    // And again for the one the worker works out for itself, which is a
    // different line of code from the one creation uses.
    await generateDueOccurrences({ groupId: group.groupId });
    const [advanced] = await listRecurringExpenses(group.groupId);
    expect(clockIn(advanced.nextRunAt)).toBe("09:00");
  });

  /**
   * The catch-up path, which is the one the hour could still have escaped
   * through: a container that comes back at three in the morning is past every
   * overdue `next_run_at` at once, and generating today's occurrence then
   * would deliver the notification at exactly the hour this is all about.
   */
  it("makes a run before nine stop at yesterday", async () => {
    const yesterday = dayIn(-1);
    const today = dayIn(0);
    const group = await dailyTemplate(yesterday);

    const earlyRun = await generateDueOccurrences({
      groupId: group.groupId,
      now: instantAt(today, 3),
    });
    expect(earlyRun.expensesCreated).toBe(1);

    const db = getDb();
    const afterEarly = await db
      .select({ date: expenses.expenseDate })
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(afterEarly.map((row) => row.date)).toEqual([yesterday]);

    const nineRun = await generateDueOccurrences({
      groupId: group.groupId,
      now: instantAt(today, 9),
    });
    expect(nineRun.expensesCreated).toBe(1);

    const afterNine = await db
      .select({ date: expenses.expenseDate })
      .from(expenses)
      .where(eq(expenses.groupId, group.groupId));
    expect(afterNine.map((row) => row.date).sort()).toEqual([yesterday, today]);
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

/** A plain monthly template, to be varied one field at a time. */
function rentInput(
  payerId: string,
  splitIds: readonly string[],
  overrides: Partial<RecurringInput> = {},
): RecurringInput {
  return {
    description: "Rent",
    notes: "",
    category: "",
    amount: "120000",
    currency: "EUR",
    exchangeRate: "",
    payers: [{ participantId: payerId, amount: "120000" }],
    splitMethod: "equal",
    splitEntries: splitIds.map((participantId) => ({ participantId })),
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 1,
    startDate: "2026-01-01",
    endDate: "",
    ...overrides,
  };
}

async function datesGeneratedBy(templateId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ date: expenses.expenseDate })
    .from(expenses)
    .where(eq(expenses.recurringExpenseId, templateId))
    .orderBy(asc(expenses.expenseDate));
  return rows.map((row) => row.date);
}

/**
 * One template that cannot produce a valid entry used to throw out of the
 * worker's loop, which ended the run for every template behind it — across
 * every group on the instance, on every tick, for as long as it existed.
 */
describe("a template that cannot generate", () => {
  const now = new Date("2026-03-10T12:00:00Z");

  /**
   * Payers of 1 against an amount of 1000. Written straight to the table,
   * because creation now refuses it; a template saved before that check
   * existed looks exactly like this.
   */
  async function insertBrokenTemplate(groupId: string, participantId: string) {
    const [row] = await getDb()
      .insert(recurringExpenses)
      .values({
        groupId,
        description: "Broken",
        amount: 1000n,
        currency: "EUR",
        payers: [{ participantId, amount: "1" }],
        splitMethod: "equal",
        splitInput: [{ participantId }],
        frequency: "daily",
        timezone: "UTC",
        startDate: "2026-03-08",
        nextRunAt: occurrenceInstant("2026-03-08", "UTC"),
        createdByActorType: "user",
      })
      .returning({
        id: recurringExpenses.id,
        nextRunAt: recurringExpenses.nextRunAt,
      });
    return row;
  }

  it("does not stop the other templates, in its group or any other", async () => {
    const actor = await createTestUser();
    const brokenGroup = await createTestGroup(actor, { name: "Broken" });
    const healthyGroup = await createTestGroup(actor, { name: "Healthy" });
    const broken = await insertBrokenTemplate(
      brokenGroup.groupId,
      brokenGroup.ownerParticipantId,
    );
    const healthy = await createRecurringExpense(
      healthyGroup.access,
      rentInput(
        healthyGroup.ownerParticipantId,
        [healthyGroup.ownerParticipantId],
        { frequency: "daily", dayOfMonth: undefined, startDate: "2026-03-08" },
      ),
    );

    const report = await generateDueOccurrences({ now });

    expect(report.templatesProcessed).toBe(2);
    expect(report.templatesFailed).toBe(1);
    expect(report.expensesCreated).toBe(3);
    expect(await datesGeneratedBy(healthy)).toEqual([
      "2026-03-08",
      "2026-03-09",
      "2026-03-10",
    ]);
    expect(await datesGeneratedBy(broken.id)).toEqual([]);
  });

  /**
   * Its marker stays where it was, so the next run tries it again rather
   * than moving past an occurrence it never made.
   */
  it("is tried again on the next run", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const broken = await insertBrokenTemplate(
      group.groupId,
      group.ownerParticipantId,
    );

    await generateDueOccurrences({ now });
    const [after] = await getDb()
      .select({ nextRunAt: recurringExpenses.nextRunAt })
      .from(recurringExpenses)
      .where(eq(recurringExpenses.id, broken.id));
    expect(after.nextRunAt).toEqual(broken.nextRunAt);

    const again = await generateDueOccurrences({
      now: new Date(now.getTime() + 60 * 60 * 1000),
    });
    expect(again).toMatchObject({ templatesProcessed: 1, templatesFailed: 1 });
  });

  /**
   * Somebody on the template leaving the group is not a failure: the
   * occurrence is skipped, as it always was, and the template moves on.
   */
  it("skips, rather than fails, when somebody on it has left the group", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const other = await addTestParticipant(group.groupId, "Blaise");
    const templateId = await createRecurringExpense(
      group.access,
      rentInput(group.ownerParticipantId, [group.ownerParticipantId, other], {
        startDate: "2026-03-01",
      }),
    );
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, other));

    const report = await generateDueOccurrences({ now });

    expect(report).toMatchObject({
      templatesFailed: 0,
      expensesCreated: 0,
      occurrencesSkipped: 1,
    });
    const [listed] = await listRecurringExpenses(group.groupId);
    expect(listed.id).toBe(templateId);
    expect(listed.nextRunAt).toEqual(occurrenceInstant("2026-04-01", "UTC"));
  });
});

/**
 * A template is the promise of an entry every month, so it is held to the
 * entry's rules when it is saved rather than when the first one falls due.
 */
describe("checking a template when it is saved", () => {
  async function setup(options: { converted?: boolean } = {}) {
    const actor = await createTestUser();
    const group = await createTestGroup(
      actor,
      options.converted
        ? { currencyMode: "converted", baseCurrency: "EUR" }
        : {},
    );
    return { actor, group };
  }

  async function templateCount(): Promise<number> {
    return (await getDb().select().from(recurringExpenses)).length;
  }

  it("refuses payers that do not add up to the amount", async () => {
    const { group } = await setup();
    const self = group.ownerParticipantId;

    await expect(
      createRecurringExpense(
        group.access,
        rentInput(self, [self], {
          amount: "1000",
          payers: [{ participantId: self, amount: "1" }],
        }),
      ),
    ).rejects.toThrow(AllocationError);
    expect(await templateCount()).toBe(0);
  });

  it("refuses a split that cannot be resolved", async () => {
    const { group } = await setup();
    const self = group.ownerParticipantId;
    const other = await addTestParticipant(group.groupId, "Blaise");

    await expect(
      createRecurringExpense(
        group.access,
        rentInput(self, [], {
          splitMethod: "exact",
          splitEntries: [
            { participantId: self, value: "100000" },
            { participantId: other, value: "1" },
          ],
        }),
      ),
    ).rejects.toThrow(AllocationError);
  });

  it("refuses somebody who is not in the group, or has left it", async () => {
    const { actor, group } = await setup();
    const self = group.ownerParticipantId;
    const elsewhere = await createTestGroup(actor, { name: "Elsewhere" });
    const departed = await addTestParticipant(group.groupId, "Blaise");
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, departed));

    await expect(
      createRecurringExpense(
        group.access,
        rentInput(self, [self, elsewhere.ownerParticipantId]),
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      createRecurringExpense(group.access, rentInput(self, [self, departed])),
    ).rejects.toThrow(AuthorizationError);
    expect(await templateCount()).toBe(0);
  });

  it("refuses a foreign currency with no rate in a group that converts", async () => {
    const { group } = await setup({ converted: true });
    const self = group.ownerParticipantId;

    await expect(
      createRecurringExpense(
        group.access,
        rentInput(self, [self], { currency: "USD", exchangeRate: "" }),
      ),
    ).rejects.toThrow(CurrencyConfigurationError);

    // With one, it is accepted.
    await expect(
      createRecurringExpense(
        group.access,
        rentInput(self, [self], { currency: "USD", exchangeRate: "0.97" }),
      ),
    ).resolves.toEqual(expect.any(String));
  });

  /** The audit's example, sent as a client would send it. */
  it("answers the API with 422, as the expense endpoint does", async () => {
    const { actor, group } = await setup();
    const self = group.ownerParticipantId;
    const { token } = await createApiToken(actor.userId, {
      name: "Phone",
      scope: "write",
      groupId: group.groupId,
    });
    const post = (path: string, body: unknown) =>
      new Request(`http://localhost/api/groups/${group.groupId}/${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
    const context = { params: Promise.resolve({ groupId: group.groupId }) };
    const unbalanced = {
      amount: "1000",
      payers: [{ participantId: self, amount: "1" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: self }],
    };

    const template = await recurringRoute.POST(
      post("recurring", {
        ...unbalanced,
        description: "Rent",
        currency: "EUR",
        frequency: "daily",
        startDate: "2026-03-08",
      }),
      context as never,
    );
    const entry = await expensesRoute.POST(
      post("expenses", {
        ...unbalanced,
        description: "Rent",
        currency: "EUR",
        expenseDate: "2026-03-08",
      }),
      context as never,
    );

    expect(template.status).toBe(422);
    expect(entry.status).toBe(422);
    expect(await template.json()).toEqual(await entry.json());
    expect(await templateCount()).toBe(0);
  });

  it("answers the form's action the way an entry's action is answered", async () => {
    const { actor, group } = await setup();
    const self = group.ownerParticipantId;
    cookieActor.value = actor;
    const unbalanced = {
      description: "Rent",
      amount: "1000",
      currency: "EUR",
      payers: [{ participantId: self, amount: "1" }],
      splitMethod: "equal",
      splitEntries: [{ participantId: self }],
    };

    try {
      const template = await createRecurringAction(group.groupId, {
        ...unbalanced,
        frequency: "daily",
        startDate: "2026-03-08",
      });
      const entry = await createExpenseAction(group.groupId, {
        ...unbalanced,
        expenseDate: "2026-03-08",
      });

      expect(template.ok).toBe(false);
      expect(template).toEqual(entry);
    } finally {
      cookieActor.value = null;
    }
  });
});

/**
 * Which rate an occurrence in a foreign currency is converted at.
 *
 * The template's rate was typed for the day it was written. An occurrence a
 * year and a half later is a different day, and it is converted at that day's
 * rate when the instance can look one up — and says honestly where its rate
 * came from, and when it was captured, either way.
 */
describe("the rate an occurrence is converted at", () => {
  const now = new Date("2026-06-01T12:00:00Z");
  const savedProvider = process.env.EXCHANGE_RATE_PROVIDER;
  const savedUrl = process.env.EXCHANGE_RATE_API_URL;

  function useProvider(provider: "frankfurter" | "none"): void {
    process.env.EXCHANGE_RATE_PROVIDER = provider;
    // A v2 root: `env.ts` refuses a v1 one.
    process.env.EXCHANGE_RATE_API_URL = "https://rates.test/v2";
    resetEnvCache();
    resetRatesProviderCache();
  }

  /** The provider is never really called; a lookup that tries fails. */
  function unreachableProvider(): ReturnType<typeof vi.fn> {
    const fetchMock = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedProvider === undefined) delete process.env.EXCHANGE_RATE_PROVIDER;
    else process.env.EXCHANGE_RATE_PROVIDER = savedProvider;
    if (savedUrl === undefined) delete process.env.EXCHANGE_RATE_API_URL;
    else process.env.EXCHANGE_RATE_API_URL = savedUrl;
    resetEnvCache();
    resetRatesProviderCache();
  });

  /** A dollar rent in a euro group, typed at 0.97. */
  async function dollarRent() {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    const self = group.ownerParticipantId;
    const templateId = await createRecurringExpense(
      group.access,
      rentInput(self, [self], {
        amount: "100000",
        payers: [{ participantId: self, amount: "100000" }],
        currency: "USD",
        exchangeRate: "0.97",
        startDate: "2026-06-01",
      }),
    );
    const [template] = await getDb()
      .select({ createdAt: recurringExpenses.createdAt })
      .from(recurringExpenses)
      .where(eq(recurringExpenses.id, templateId));
    return { group, templateId, createdAt: template.createdAt };
  }

  async function generatedEntry(templateId: string) {
    const [entry] = await getDb()
      .select({
        exchangeRate: expenses.exchangeRate,
        exchangeRateSource: expenses.exchangeRateSource,
        exchangeRateAt: expenses.exchangeRateAt,
        convertedAmount: expenses.convertedAmount,
      })
      .from(expenses)
      .where(eq(expenses.recurringExpenseId, templateId));
    return entry;
  }

  it("takes the day's quote, labelled as fetched, when the instance holds one", async () => {
    useProvider("frankfurter");
    const fetchMock = unreachableProvider();
    const { group, templateId } = await dollarRent();
    const fetchedAt = new Date("2026-06-01T10:15:00Z");
    await getDb().insert(exchangeRateQuotes).values({
      provider: "frankfurter",
      baseCurrency: "USD",
      quoteCurrency: "EUR",
      rateDate: "2026-06-01",
      quotedOn: "2026-06-01",
      rate: "0.91",
      fetchedAt,
    });

    const report = await generateDueOccurrences({
      groupId: group.groupId,
      now,
    });

    expect(report.expensesCreated).toBe(1);
    const entry = await generatedEntry(templateId);
    expect(Number(entry.exchangeRate)).toBe(0.91);
    expect(entry.exchangeRateSource).toBe("api");
    expect(entry.exchangeRateAt).toEqual(fetchedAt);
    expect(entry.convertedAmount).toBe(91000n);
    // Served from the cache: a past day's fixing never changes.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps the typed rate, labelled as typed and dated by the template, with no provider", async () => {
    useProvider("none");
    const { group, templateId, createdAt } = await dollarRent();

    await generateDueOccurrences({ groupId: group.groupId, now });

    const entry = await generatedEntry(templateId);
    expect(Number(entry.exchangeRate)).toBe(0.97);
    expect(entry.exchangeRateSource).toBe("manual");
    expect(entry.exchangeRateAt).toEqual(createdAt);
    expect(entry.convertedAmount).toBe(97000n);
  });

  it("falls back to the typed rate, rather than failing, when the provider does", async () => {
    useProvider("frankfurter");
    const fetchMock = unreachableProvider();
    const { group, templateId, createdAt } = await dollarRent();

    const report = await generateDueOccurrences({
      groupId: group.groupId,
      now,
    });

    expect(fetchMock).toHaveBeenCalled();
    expect(report).toMatchObject({ expensesCreated: 1, templatesFailed: 0 });
    const entry = await generatedEntry(templateId);
    expect(Number(entry.exchangeRate)).toBe(0.97);
    expect(entry.exchangeRateSource).toBe("manual");
    expect(entry.exchangeRateAt).toEqual(createdAt);
  });
});

/**
 * What fell due while a template stood still — paused, or in an archived
 * group — is skipped, not back-filled. A monthly rent paused on 1 March and
 * resumed on 20 June used to arrive as April, May and June at the next tick,
 * each with its own notification. An outage is a different thing: nobody
 * chose it, and what it missed is still caught up.
 */
describe("a template that stood still", () => {
  const ZONE = "Europe/Paris";

  /** That day, at that hour, in the group's zone. */
  function at(date: string, hour: number): Date {
    return DateTime.fromISO(date, { zone: ZONE }).set({ hour }).toJSDate();
  }

  async function monthlyRent(overrides: Partial<RecurringInput> = {}) {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { timezone: ZONE });
    const other = await addTestParticipant(group.groupId, "Blaise");
    const templateId = await createRecurringExpense(
      group.access,
      rentInput(
        group.ownerParticipantId,
        [group.ownerParticipantId, other],
        overrides,
      ),
    );
    return { group, templateId };
  }

  async function nextRunOf(groupId: string): Promise<Date | null> {
    const [template] = await listRecurringExpenses(groupId);
    return template.nextRunAt;
  }

  it("skips what fell due while it was paused", async () => {
    const { group, templateId } = await monthlyRent();
    const { groupId } = group;
    await generateDueOccurrences({ groupId, now: at("2026-03-01", 10) });

    await setRecurringPaused(group.access, templateId, true, {
      now: at("2026-03-01", 12),
    });
    await generateDueOccurrences({ groupId, now: at("2026-05-01", 10) });
    await setRecurringPaused(group.access, templateId, false, {
      now: at("2026-06-20", 12),
    });

    // Next on the first occurrence due on or after 20 June, at nine.
    expect(await nextRunOf(groupId)).toEqual(at("2026-07-01", 9));

    const resumed = await generateDueOccurrences({
      groupId,
      now: at("2026-06-20", 13),
    });
    expect(resumed.expensesCreated).toBe(0);

    const july = await generateDueOccurrences({
      groupId,
      now: at("2026-07-01", 10),
    });
    expect(july.expensesCreated).toBe(1);
    expect(await datesGeneratedBy(templateId)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-07-01",
    ]);
  });

  it("skips what fell due while its group was archived", async () => {
    const { group, templateId } = await monthlyRent();
    const { groupId } = group;
    await generateDueOccurrences({ groupId, now: at("2026-03-01", 10) });

    await setGroupArchived(group.access, true, { now: at("2026-03-02", 12) });
    const archived = await generateDueOccurrences({
      groupId,
      now: at("2026-05-01", 10),
    });
    expect(archived.templatesProcessed).toBe(0);
    await setGroupArchived(group.access, false, { now: at("2026-06-20", 12) });

    expect(await nextRunOf(groupId)).toEqual(at("2026-07-01", 9));

    const unarchived = await generateDueOccurrences({
      groupId,
      now: at("2026-06-20", 13),
    });
    expect(unarchived.expensesCreated).toBe(0);

    await generateDueOccurrences({ groupId, now: at("2026-07-01", 10) });
    expect(await datesGeneratedBy(templateId)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-07-01",
    ]);
  });

  it("still gives a counted series all of its occurrences", async () => {
    const { group, templateId } = await monthlyRent({ count: 4 });
    const { groupId } = group;
    await generateDueOccurrences({ groupId, now: at("2026-02-01", 10) });

    await setRecurringPaused(group.access, templateId, true, {
      now: at("2026-02-02", 12),
    });
    await setRecurringPaused(group.access, templateId, false, {
      now: at("2026-06-20", 12),
    });
    for (const month of ["2026-07-01", "2026-08-01", "2026-09-01"]) {
      await generateDueOccurrences({ groupId, now: at(month, 10) });
    }

    // Four real ones, the months it stood still not among them.
    expect(await datesGeneratedBy(templateId)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-07-01",
      "2026-08-01",
    ]);
    expect(await nextRunOf(groupId)).toBeNull();
  });

  it("still catches up after the worker was down, when nobody paused it", async () => {
    const { group, templateId } = await monthlyRent();
    const { groupId } = group;
    await generateDueOccurrences({ groupId, now: at("2026-01-01", 10) });

    // Nothing ran from January to mid-April.
    const back = await generateDueOccurrences({
      groupId,
      now: at("2026-04-15", 10),
    });

    expect(back.expensesCreated).toBe(3);
    expect(await datesGeneratedBy(templateId)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
      "2026-04-01",
    ]);
  });
});
