import { asc, eq } from "drizzle-orm";
import { DateTime } from "luxon";
import { describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  expenses,
  groupMembers,
  participants,
  recurringExpenses,
} from "@/lib/db/schema";
import {
  AuthorizationError,
  type UserActor,
} from "@/lib/security/authorization";
import { createApiToken } from "@/modules/api-tokens/service";
import {
  countRecurringExpenses,
  generateDueOccurrences,
  getRecurringExpense,
  setRecurringPaused,
  setUpRecurringExpense,
  updateRecurringExpense,
  type RecurringInput,
} from "@/modules/recurring/service";
import { RecurrenceError } from "@/modules/recurring/schedule";
import { createTestGroup, createTestUser } from "../helpers/factories";

/*
 * The Server Action and the route are called directly near the foot of this
 * file, with the session, the cache and the translations stood in for, as in
 * `recurring-set-up.test.ts`.
 */
const cookieActor = vi.hoisted(() => ({ value: null as UserActor | null }));
const revalidated = vi.hoisted(() => [] as string[]);

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => cookieActor.value,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    revalidated.push(path);
  },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async () =>
    Object.assign((key: string) => key, { has: () => false }),
}));

const templateRoute =
  await import("@/app/api/groups/[groupId]/recurring/[templateId]/route");
const { updateRecurringAction } = await import("@/modules/recurring/actions");

/**
 * Changing a recurring expense, for the entries still to come.
 *
 * The audit's case: a recurring expense could be paused or deleted and
 * nothing else, so when the rent went up, or a flatmate left, the rule had to
 * be deleted and set up again from memory.
 */

const PARIS = "Europe/Paris";

/** That day, at that hour, in Paris. */
function at(date: string, hour: number, minute = 0): Date {
  return DateTime.fromISO(date, { zone: PARIS })
    .set({ hour, minute })
    .toJSDate();
}

function inZone(instant: Date | null): string | null {
  if (!instant) return null;
  return DateTime.fromJSDate(instant)
    .setZone(PARIS)
    .toFormat("yyyy-MM-dd HH:mm");
}

async function setup() {
  const owner = await createTestUser({ name: "Robin" });
  const group = await createTestGroup(owner, { timezone: PARIS });
  const flatmate = await createTestUser({ name: "Blaise" });
  const [participant] = await getDb()
    .insert(participants)
    .values({
      groupId: group.groupId,
      displayName: "Blaise",
      email: flatmate.email,
      userId: flatmate.userId,
    })
    .returning({ id: participants.id });
  await getDb().insert(groupMembers).values({
    groupId: group.groupId,
    userId: flatmate.userId,
    participantId: participant.id,
    role: "member",
  });
  return { owner, group, flatmateId: participant.id };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** €900 of rent a month, on the 5th, split between the two of them. */
function rent(
  fixture: Fixture,
  overrides: Partial<RecurringInput> = {},
): RecurringInput {
  const self = fixture.group.ownerParticipantId;
  const amount = overrides.amount ?? "90000";
  return {
    description: "Rent",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    payers: [{ participantId: self, amount }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: self },
      { participantId: fixture.flatmateId },
    ],
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 5,
    startDate: "2026-08-05",
    endDate: "",
    ...overrides,
  };
}

async function entriesOf(
  templateId: string,
): Promise<{ date: string; amount: bigint }[]> {
  return getDb()
    .select({ date: expenses.expenseDate, amount: expenses.amount })
    .from(expenses)
    .where(eq(expenses.recurringExpenseId, templateId))
    .orderBy(asc(expenses.expenseDate));
}

async function templateRow(templateId: string) {
  const [row] = await getDb()
    .select()
    .from(recurringExpenses)
    .where(eq(recurringExpenses.id, templateId));
  return row;
}

/** Rent set up in August, with August to October already in the group. */
async function withThreeMonths() {
  const fixture = await setup();
  const saved = await setUpRecurringExpense(
    fixture.group.access,
    rent(fixture),
    {
      now: at("2026-10-05", 12),
    },
  );
  expect(saved.added).toBe(3);
  return { ...fixture, id: saved.id };
}

/** The edit as the form sends it: the window's own start, and `changes`. */
async function edit(
  fixture: Fixture & { id: string },
  changes: Partial<RecurringInput>,
  now = at("2026-10-06", 10),
) {
  const detail = await getRecurringExpense(fixture.group.groupId, fixture.id, {
    now,
  });
  expect(detail).not.toBeNull();
  return updateRecurringExpense(
    fixture.group.access,
    fixture.id,
    rent(fixture, { startDate: detail!.edit.from, ...changes }),
    { now },
  );
}

describe("changing the amount", () => {
  it("leaves the entries already added as they were, and uses the new one from the next", async () => {
    const fixture = await withThreeMonths();

    const updated = await edit(fixture, {
      amount: "95000",
      payers: [
        { participantId: fixture.group.ownerParticipantId, amount: "95000" },
      ],
    });

    expect(updated).toEqual({
      id: fixture.id,
      next: "2026-11-05",
      paused: false,
    });
    // August to October, untouched.
    expect(await entriesOf(fixture.id)).toEqual([
      { date: "2026-08-05", amount: 90000n },
      { date: "2026-09-05", amount: 90000n },
      { date: "2026-10-05", amount: 90000n },
    ]);
    // Its next date is where it was.
    expect(inZone((await templateRow(fixture.id)).nextRunAt)).toBe(
      "2026-11-05 09:00",
    );

    const tick = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-11-05", 10),
    });
    expect(tick.expensesCreated).toBe(1);
    expect((await entriesOf(fixture.id)).at(-1)).toEqual({
      date: "2026-11-05",
      amount: 95000n,
    });
  });

  it("records the change in the group's activity", async () => {
    const fixture = await withThreeMonths();
    await edit(fixture, { description: "Rent and charges" });

    const events = await getDb()
      .select({ action: activityEvents.action })
      .from(activityEvents)
      .where(eq(activityEvents.entityId, fixture.id));
    expect(events.map((event) => event.action)).toContain("recurring.updated");
    expect((await templateRow(fixture.id)).description).toBe(
      "Rent and charges",
    );
  });
});

/**
 * An edit to the schedule starts it again from the beginning of the period
 * its next date falls in — November, here — so the day moves within that
 * month: never a second entry in October, which is paid, and never skipping
 * November.
 */
describe("changing the day", () => {
  it("moves an earlier day into the coming month, not the one after", async () => {
    const fixture = await withThreeMonths();

    const updated = await edit(fixture, { dayOfMonth: 1 });

    expect(updated.next).toBe("2026-11-01");
  });

  it("moves a later day within the coming month, not into the month paid", async () => {
    const fixture = await withThreeMonths();

    const updated = await edit(fixture, { dayOfMonth: 20 });

    expect(updated.next).toBe("2026-11-20");
    const tick = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-20", 10),
    });
    expect(tick.expensesCreated).toBe(0);
  });

  /**
   * A weekly rule steps a week at a time from its last entry, so a series
   * whose last entry was a Monday would go on being Mondays without the
   * rule's new start between them.
   */
  it("lands a weekly rule on its new weekday, and keeps it there", async () => {
    const fixture = await setup();
    const saved = await setUpRecurringExpense(
      fixture.group.access,
      rent(fixture, {
        frequency: "weekly",
        dayOfMonth: undefined,
        weekday: 1,
        startDate: "2026-09-28",
      }),
      { now: at("2026-10-05", 12) },
    );
    const weekly = { ...fixture, id: saved.id };

    const updated = await edit(weekly, {
      frequency: "weekly",
      dayOfMonth: undefined,
      weekday: 5,
    });

    expect(updated.next).toBe("2026-10-16");
    await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-16", 10),
    });
    await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-23", 10),
    });
    expect((await entriesOf(saved.id)).map((entry) => entry.date)).toEqual([
      "2026-09-28",
      "2026-10-05",
      "2026-10-16",
      "2026-10-23",
    ]);
  });

  it("never starts on a day that is over, whatever the request says", async () => {
    const fixture = await withThreeMonths();

    const updated = await updateRecurringExpense(
      fixture.group.access,
      fixture.id,
      rent(fixture, { dayOfMonth: 1, startDate: "2026-01-01" }),
      { now: at("2026-10-06", 10) },
    );

    // From today: 1 October has gone, so the first is 1 November.
    expect(updated.next).toBe("2026-11-01");
    expect((await templateRow(fixture.id)).startDate).toBe("2026-10-06");
    const tick = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-06", 11),
    });
    expect(tick.expensesCreated).toBe(0);
    expect(await entriesOf(fixture.id)).toHaveLength(3);
  });

  it("refuses an end before the next date it could add", async () => {
    const fixture = await withThreeMonths();

    await expect(edit(fixture, { endDate: "2026-10-01" })).rejects.toThrow(
      RecurrenceError,
    );
  });
});

describe("a paused recurring expense", () => {
  it("stays paused, and adds nothing until it is resumed", async () => {
    const fixture = await withThreeMonths();
    await setRecurringPaused(fixture.group.access, fixture.id, true, {
      now: at("2026-10-05", 13),
    });

    const updated = await edit(fixture, { dayOfMonth: 1 });

    expect(updated.paused).toBe(true);
    expect((await templateRow(fixture.id)).pausedAt).not.toBeNull();
    const tick = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-11-01", 10),
    });
    expect(tick.expensesCreated).toBe(0);
    expect(await countRecurringExpenses(fixture.group.groupId)).toEqual({
      total: 1,
      running: 0,
    });

    // Resumed in mid-November, it picks up on the edited rule's next day.
    await setRecurringPaused(fixture.group.access, fixture.id, false, {
      now: at("2026-11-15", 10),
    });
    expect(inZone((await templateRow(fixture.id)).nextRunAt)).toBe(
      "2026-12-01 09:00",
    );
  });
});

describe("who may change one", () => {
  it("refuses somebody without the permission", async () => {
    const fixture = await withThreeMonths();
    const access = {
      ...fixture.group.access,
      permissions: {
        ...fixture.group.access.permissions,
        manageRecurring: false,
      },
    };

    await expect(
      updateRecurringExpense(access, fixture.id, rent(fixture), {
        now: at("2026-10-06", 10),
      }),
    ).rejects.toThrow(AuthorizationError);
    expect((await templateRow(fixture.id)).amount).toBe(90000n);
  });

  it("does not reach a template in another group", async () => {
    const fixture = await withThreeMonths();
    const other = await setup();

    await expect(
      updateRecurringExpense(
        other.group.access,
        fixture.id,
        rent(other, { startDate: "2026-11-01" }),
        { now: at("2026-10-06", 10) },
      ),
    ).rejects.toThrow(AuthorizationError);
    expect(
      await getRecurringExpense(other.group.groupId, fixture.id),
    ).toBeNull();
  });

  it("refuses somebody who has left the group", async () => {
    const fixture = await withThreeMonths();
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, fixture.flatmateId));

    await expect(edit(fixture, {})).rejects.toThrow(AuthorizationError);
  });
});

describe("the form's action and the API", () => {
  it("changes it from the Server Action, and refreshes the Recurring screen", async () => {
    const fixture = await withThreeMonths();
    cookieActor.value = fixture.owner;
    revalidated.length = 0;

    try {
      const result = await updateRecurringAction(
        fixture.group.groupId,
        fixture.id,
        rent(fixture, { description: "Loyer", startDate: "2099-01-01" }),
      );

      expect(result).toEqual({
        ok: true,
        data: { id: fixture.id, next: "2099-01-05", paused: false },
      });
      expect(revalidated).toContain(
        `/groups/${fixture.group.groupId}/recurring`,
      );
    } finally {
      cookieActor.value = null;
    }
  });

  it("refuses a template id that is not one, before reaching anything", async () => {
    const fixture = await setup();
    cookieActor.value = fixture.owner;
    try {
      const result = await updateRecurringAction(
        fixture.group.groupId,
        "not-a-uuid",
        rent(fixture),
      );
      expect(result.ok).toBe(false);
    } finally {
      cookieActor.value = null;
    }
  });

  it("reads it whole and changes it from the API", async () => {
    const fixture = await withThreeMonths();
    const { token } = await createApiToken(fixture.owner.userId, {
      name: "Phone",
      scope: "write",
      groupId: fixture.group.groupId,
    });
    const url = `http://localhost/api/groups/${fixture.group.groupId}/recurring/${fixture.id}`;
    const context = {
      params: Promise.resolve({
        groupId: fixture.group.groupId,
        templateId: fixture.id,
      }),
    } as never;

    const read = await templateRoute.GET(
      new Request(url, { headers: { Authorization: `Bearer ${token}` } }),
      context,
    );
    expect(read.status).toBe(200);
    const { template } = (await read.json()) as {
      template: Record<string, unknown>;
    };
    expect(template).toMatchObject({
      id: fixture.id,
      amount: "90000",
      splitMethod: "equal",
      dayOfMonth: 5,
      generatedCount: 3,
    });
    expect(template.payers).toEqual([
      { participantId: fixture.group.ownerParticipantId, amount: "90000" },
    ]);

    const response = await templateRoute.PUT(
      new Request(url, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(
          rent(fixture, {
            description: "Loyer",
            startDate: String(template.editFrom),
          }),
        ),
      }),
      context,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: fixture.id,
      next: expect.stringMatching(/^\d{4}-\d{2}-05$/),
      paused: false,
    });
    expect((await templateRow(fixture.id)).description).toBe("Loyer");
  });

  it("answers a read-only key with a refusal", async () => {
    const fixture = await withThreeMonths();
    const { token } = await createApiToken(fixture.owner.userId, {
      name: "Reader",
      scope: "read",
      groupId: fixture.group.groupId,
    });

    const response = await templateRoute.PUT(
      new Request(
        `http://localhost/api/groups/${fixture.group.groupId}/recurring/${fixture.id}`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(rent(fixture)),
        },
      ),
      {
        params: Promise.resolve({
          groupId: fixture.group.groupId,
          templateId: fixture.id,
        }),
      } as never,
    );

    expect(response.status).toBe(403);
    expect((await templateRow(fixture.id)).description).toBe("Rent");
  });
});
