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
import type { UserActor } from "@/lib/security/authorization";
import { createApiToken } from "@/modules/api-tokens/service";
import { loadGroupBalances } from "@/modules/balances/service";
import { listNotifications } from "@/modules/notifications/service";
import {
  generateDueOccurrences,
  setRecurringPaused,
  setUpRecurringExpense,
  type RecurringInput,
} from "@/modules/recurring/service";
import {
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/*
 * The Server Action and the route are called directly at the foot of this
 * file. Neither has a request around it here, so the cookie session, the cache
 * and the translation lookup are stood in for, as in `recurring.test.ts`.
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

const recurringRoute =
  await import("@/app/api/groups/[groupId]/recurring/route");
const { createRecurringAction } = await import("@/modules/recurring/actions");

/**
 * Saving a series adds what of it has already come.
 *
 * The audit's case: €90 of internet, monthly, today's date, saved at 19:55.
 * The confirmation said "saved", the group showed nothing, and the expense
 * arrived with the worker at 20:00 — by which time anybody who had believed
 * their eyes over the toast had added it by hand, and now had it twice.
 */

const PARIS = "Europe/Paris";

/** That day, at that hour and minute, in a zone. */
function at(date: string, hour: number, minute = 0, zone = PARIS): Date {
  return DateTime.fromISO(date, { zone }).set({ hour, minute }).toJSDate();
}

/** The clock and day a stored instant reads as in a zone. */
function inZone(instant: Date | null, zone = PARIS): string | null {
  if (!instant) return null;
  return DateTime.fromJSDate(instant)
    .setZone(zone)
    .toFormat("yyyy-MM-dd HH:mm");
}

/** A second account in the group, so a notification has somebody to reach. */
async function addTestMember(
  groupId: string,
  name: string,
): Promise<{ actor: UserActor; participantId: string }> {
  const db = getDb();
  const actor = await createTestUser({ name });
  const [participant] = await db
    .insert(participants)
    .values({
      groupId,
      displayName: name,
      email: actor.email,
      userId: actor.userId,
    })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId,
    userId: actor.userId,
    participantId: participant.id,
    role: "member",
  });
  return { actor, participantId: participant.id };
}

async function setup(timezone = PARIS) {
  const owner = await createTestUser({ name: "Robin" });
  const group = await createTestGroup(owner, { timezone });
  const member = await addTestMember(group.groupId, "Blaise");
  return { owner, group, member };
}

type Fixture = Awaited<ReturnType<typeof setup>>;

/** €90 of internet a month, on the 5th, split between the two of them. */
function internet(
  fixture: Fixture,
  overrides: Partial<RecurringInput> = {},
): RecurringInput {
  const self = fixture.group.ownerParticipantId;
  return {
    description: "Internet",
    notes: "",
    category: "",
    amount: "9000",
    currency: "EUR",
    exchangeRate: "",
    payers: [{ participantId: self, amount: "9000" }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: self },
      { participantId: fixture.member.participantId },
    ],
    frequency: "monthly",
    interval: 1,
    dayOfMonth: 5,
    startDate: "2026-10-05",
    endDate: "",
    ...overrides,
  };
}

async function datesOf(templateId: string): Promise<string[]> {
  const rows = await getDb()
    .select({ date: expenses.expenseDate })
    .from(expenses)
    .where(eq(expenses.recurringExpenseId, templateId))
    .orderBy(asc(expenses.expenseDate));
  return rows.map((row) => row.date);
}

async function nextRunOf(templateId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ nextRunAt: recurringExpenses.nextRunAt })
    .from(recurringExpenses)
    .where(eq(recurringExpenses.id, templateId));
  return row.nextRunAt;
}

describe("a series whose first date has come", () => {
  it("is in the group by the time it is saved, and the worker does not make it again", async () => {
    const fixture = await setup();
    const { group } = fixture;

    const saved = await setUpRecurringExpense(group.access, internet(fixture), {
      now: at("2026-10-05", 19, 55),
    });

    expect(saved).toEqual({
      id: expect.any(String),
      added: 1,
      addedFrom: "2026-10-05",
      next: "2026-11-05",
    });
    expect(await datesOf(saved.id)).toEqual(["2026-10-05"]);
    // The balances moved with it, not an hour later.
    const balances = await loadGroupBalances(group.access);
    expect(balances.totalSpend.get("EUR")).toBe(9000n);
    // And the Recurring screen's "Next:" has moved on to November.
    expect(inZone(await nextRunOf(saved.id))).toBe("2026-11-05 09:00");

    // The tick at 20:00, which is where the duplicate used to come from.
    const tick = await generateDueOccurrences({
      groupId: group.groupId,
      now: at("2026-10-05", 20),
    });
    expect(tick.expensesCreated).toBe(0);
    expect(await datesOf(saved.id)).toEqual(["2026-10-05"]);
  });

  /**
   * The worker would hold today's occurrence until nine, so that nobody is
   * notified about the rent in the small hours. Somebody saving the series at
   * seven is adding the expense at seven, and it is there when they look.
   */
  it("counts today from the first minute, not from nine", async () => {
    const fixture = await setup();

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture),
      { now: at("2026-10-05", 7) },
    );

    expect(saved.added).toBe(1);
    expect(await datesOf(saved.id)).toEqual(["2026-10-05"]);

    const nine = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-05", 9),
    });
    expect(nine.expensesCreated).toBe(0);
  });

  /**
   * A start date in the past is caught up to today, which is what the
   * worker's next tick would have done anyway — only now rather than within
   * the hour.
   */
  it("catches up every date from a start in the past", async () => {
    const fixture = await setup();

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture, { startDate: "2026-08-05" }),
      { now: at("2026-10-05", 12) },
    );

    expect(saved).toMatchObject({
      added: 3,
      addedFrom: "2026-08-05",
      next: "2026-11-05",
    });
    expect(await datesOf(saved.id)).toEqual([
      "2026-08-05",
      "2026-09-05",
      "2026-10-05",
    ]);

    const tick = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-05", 13),
    });
    expect(tick.expensesCreated).toBe(0);
  });

  it("says there is no next one when what it added was all of it", async () => {
    const fixture = await setup();

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture, { count: 1 }),
      { now: at("2026-10-05", 12) },
    );

    expect(saved).toMatchObject({ added: 1, next: null });
    expect(await nextRunOf(saved.id)).toBeNull();
  });

  /**
   * What the worker records for an occurrence is recorded here too, and the
   * notification goes to everybody in the split but the person saving it —
   * the rule every entry somebody adds by hand already follows.
   */
  it("tells the rest of the split, and not the person who saved it", async () => {
    const fixture = await setup();

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture),
      { now: at("2026-10-05", 19, 55) },
    );

    const forMember = await listNotifications(fixture.member.actor.userId);
    expect(forMember).toHaveLength(1);
    expect(forMember[0].type).toBe("recurring.generated");
    expect(await listNotifications(fixture.owner.userId)).toHaveLength(0);

    const generated = await getDb()
      .select({ actorType: activityEvents.actorType })
      .from(activityEvents)
      .where(eq(activityEvents.action, "recurring.generated"));
    expect(generated).toEqual([{ actorType: "system" }]);
    expect(await datesOf(saved.id)).toHaveLength(1);
  });

  /** Resume is untouched: it still picks up at the first date to come. */
  it("is paused and resumed as any other series is", async () => {
    const fixture = await setup();
    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture),
      { now: at("2026-10-05", 19, 55) },
    );

    await setRecurringPaused(fixture.group.access, saved.id, true, {
      now: at("2026-10-05", 20),
    });
    await setRecurringPaused(fixture.group.access, saved.id, false, {
      now: at("2026-10-05", 21),
    });

    expect(inZone(await nextRunOf(saved.id))).toBe("2026-11-05 09:00");
    const tick = await generateDueOccurrences({
      groupId: fixture.group.groupId,
      now: at("2026-10-05", 22),
    });
    expect(tick.expensesCreated).toBe(0);
    expect(await datesOf(saved.id)).toEqual(["2026-10-05"]);
  });
});

describe("a series whose first date is still to come", () => {
  it("adds nothing yet, and says when it will", async () => {
    const fixture = await setup();

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture, { startDate: "2026-11-05" }),
      { now: at("2026-10-05", 19, 55) },
    );

    expect(saved).toMatchObject({
      added: 0,
      addedFrom: null,
      next: "2026-11-05",
    });
    expect(await datesOf(saved.id)).toEqual([]);
    expect(inZone(await nextRunOf(saved.id))).toBe("2026-11-05 09:00");
    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      0,
    );
  });
});

/**
 * "Today" is the group's, not the server's and not the phone's: the schedule
 * runs on the group's calendar, so that is the one the first date is held to.
 */
describe("a group in another time zone", () => {
  it("counts a date that has come in the group's zone, though not yet in UTC", async () => {
    const fixture = await setup("Pacific/Auckland");
    // 12:00 UTC on the 5th is 01:00 on the 6th in Auckland.
    const now = new Date("2026-10-05T12:00:00Z");

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture, {
        frequency: "daily",
        dayOfMonth: undefined,
        startDate: "2026-10-06",
      }),
      { now },
    );

    expect(saved).toMatchObject({ added: 1, next: "2026-10-07" });
  });

  it("waits for a date that has come in UTC but not yet in the group's zone", async () => {
    const fixture = await setup("America/Los_Angeles");
    // 03:00 UTC on the 5th is still 20:00 on the 4th in Los Angeles.
    const now = new Date("2026-10-05T03:00:00Z");

    const saved = await setUpRecurringExpense(
      fixture.group.access,
      internet(fixture, {
        frequency: "daily",
        dayOfMonth: undefined,
        startDate: "2026-10-05",
      }),
      { now },
    );

    expect(saved).toMatchObject({ added: 0, next: "2026-10-05" });
    expect(await datesOf(saved.id)).toEqual([]);
  });
});

/** Both ways in say the same thing, from the same service. */
describe("the form's action and the API", () => {
  /** Daily, from today in UTC — the group's zone — on the real clock. */
  function dailyFromToday(fixture: Fixture): RecurringInput {
    return internet(fixture, {
      frequency: "daily",
      dayOfMonth: undefined,
      startDate: isoToday(),
    });
  }

  it("adds the first expense from the Server Action, and refreshes the group's screens", async () => {
    const fixture = await setup("UTC");
    cookieActor.value = fixture.owner;
    revalidated.length = 0;

    try {
      const result = await createRecurringAction(
        fixture.group.groupId,
        dailyFromToday(fixture),
      );

      expect(result).toEqual({
        ok: true,
        data: {
          id: expect.any(String),
          added: 1,
          addedFrom: isoToday(),
          next: isoToday(1),
        },
      });
      expect(await datesOf(result.data!.id)).toEqual([isoToday()]);
      expect(revalidated).toEqual(
        expect.arrayContaining([
          `/groups/${fixture.group.groupId}`,
          `/groups/${fixture.group.groupId}/expenses`,
          `/groups/${fixture.group.groupId}/settle`,
          `/groups/${fixture.group.groupId}/recurring`,
        ]),
      );
    } finally {
      cookieActor.value = null;
    }
  });

  it("adds the first expense from the API, and answers with the same facts", async () => {
    const fixture = await setup("UTC");
    const { token } = await createApiToken(fixture.owner.userId, {
      name: "Phone",
      scope: "write",
      groupId: fixture.group.groupId,
    });

    const response = await recurringRoute.POST(
      new Request(
        `http://localhost/api/groups/${fixture.group.groupId}/recurring`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(dailyFromToday(fixture)),
        },
      ),
      { params: Promise.resolve({ groupId: fixture.group.groupId }) } as never,
    );

    expect(response.status).toBe(201);
    const body = (await response.json()) as { id: string };
    expect(body).toEqual({
      id: expect.any(String),
      added: 1,
      addedFrom: isoToday(),
      next: isoToday(1),
    });
    expect(await datesOf(body.id)).toEqual([isoToday()]);
  });
});
