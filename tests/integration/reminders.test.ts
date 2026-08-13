import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  groupMembers,
  notificationGroupMutes,
  notificationPreferences,
  participants,
  pushSubscriptions,
  reminders,
} from "@/lib/db/schema";
import { authorizeGroup, type UserActor } from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import { listNotifications } from "@/modules/notifications/service";
import type { ReminderPayload } from "@/modules/notifications/types";
import {
  listRemindRecipients,
  ReminderError,
  sendReminder,
} from "@/modules/reminders/service";
import {
  createTestGroup,
  createTestUser,
  addTestParticipant,
  isoToday,
} from "../helpers/factories";

/**
 * Reminders, end to end.
 *
 * The rules worth proving are the ones a screen cannot enforce: only debts to
 * the caller can be nudged, only once a day, a silenced group is never pushed
 * to, and every reminder leaves a trace in the activity log.
 */

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

/** A device the push sender could reach, which is what makes a channel "push". */
async function subscribeDevice(userId: string): Promise<void> {
  await getDb()
    .insert(pushSubscriptions)
    .values({
      userId,
      endpoint: `https://push.example/${userId}`,
      p256dh: "key",
      auth: "secret",
    });
}

interface Fixture {
  owner: UserActor;
  group: Awaited<ReturnType<typeof createTestGroup>>;
  debtor: { actor: UserActor; participantId: string };
}

let fixture: Fixture;

/** The owner pays for everyone, so everyone else ends up owing them. */
async function spend(amount: string): Promise<void> {
  await createExpense(fixture.group.access, {
    description: "Dinner",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    payers: [{ participantId: fixture.group.ownerParticipantId, amount }],
    splitMethod: "equal" as const,
    splitEntries: [
      { participantId: fixture.group.ownerParticipantId },
      { participantId: fixture.debtor.participantId },
    ],
    expenseDate: isoToday(),
  });
}

beforeEach(async () => {
  const owner = await createTestUser({ name: "Seb" });
  const group = await createTestGroup(owner, { name: "Portugal, March" });
  const debtor = await addTestMember(group.groupId, "Jonas");
  fixture = { owner, group, debtor };
});

describe("who can be reminded", () => {
  it("lists the people who owe the reader, largest debt first", async () => {
    const other = await addTestMember(fixture.group.groupId, "Padi");
    await spend("4800");
    await createExpense(fixture.group.access, {
      description: "Taxi",
      notes: "",
      category: "",
      amount: "10000",
      currency: "EUR",
      exchangeRate: "",
      payers: [
        { participantId: fixture.group.ownerParticipantId, amount: "10000" },
      ],
      splitMethod: "equal" as const,
      splitEntries: [
        { participantId: fixture.group.ownerParticipantId },
        { participantId: other.participantId },
      ],
      expenseDate: isoToday(),
    });

    const recipients = await listRemindRecipients(fixture.group.access);

    expect(recipients.map((recipient) => recipient.name)).toEqual([
      "Padi",
      "Jonas",
    ]);
    expect(recipients[0].amount).toBe("5000");
    expect(recipients[1].amount).toBe("2400");
  });

  /**
   * Reminding is not a general-purpose message: it is attached to a debt owed
   * to the person sending it. Someone who owes money has nobody to remind.
   */
  it("gives a debtor nobody to remind", async () => {
    await spend("4800");
    const access = await authorizeGroup(
      fixture.debtor.actor,
      fixture.group.groupId,
    );

    expect(await listRemindRecipients(access)).toEqual([]);
  });

  it("routes through the sender when the debtor has no device", async () => {
    await spend("4800");
    const [recipient] = await listRemindRecipients(fixture.group.access);
    expect(recipient.channel).toBe("share");
  });

  it("routes through Balancia when the debtor has one", async () => {
    await subscribeDevice(fixture.debtor.actor.userId);
    await spend("4800");
    const [recipient] = await listRemindRecipients(fixture.group.access);
    expect(recipient.channel).toBe("push");
  });

  it("never pushes to a group the debtor silenced", async () => {
    await subscribeDevice(fixture.debtor.actor.userId);
    await getDb().insert(notificationGroupMutes).values({
      userId: fixture.debtor.actor.userId,
      groupId: fixture.group.groupId,
    });
    await spend("4800");

    const [recipient] = await listRemindRecipients(fixture.group.access);
    expect(recipient.channel).toBe("share");
    expect(recipient.muted).toBe(true);
  });

  it("honours the reminders switch being off", async () => {
    await subscribeDevice(fixture.debtor.actor.userId);
    await getDb().insert(notificationPreferences).values({
      userId: fixture.debtor.actor.userId,
      remindersEnabled: false,
    });
    await spend("4800");

    const [recipient] = await listRemindRecipients(fixture.group.access);
    expect(recipient.channel).toBe("share");
  });
});

describe("sending one", () => {
  it("records the debt as it stood, and logs that it happened", async () => {
    await spend("4800");
    const result = await sendReminder(fixture.group.access, {
      toParticipantId: fixture.debtor.participantId,
      message: "Still open from Portugal, March: €24.00 owed to Seb.",
      logToActivity: true,
    });

    expect(result.channel).toBe("share");
    expect(result.shareText).toContain("Portugal");

    const rows = await getDb()
      .select()
      .from(reminders)
      .where(eq(reminders.groupId, fixture.group.groupId));
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(2400n);
    expect(rows[0].currency).toBe("EUR");
    expect(rows[0].channel).toBe("share");

    const events = await getDb()
      .select()
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.groupId, fixture.group.groupId),
          eq(activityEvents.action, "reminder.sent"),
        ),
      );
    expect(events).toHaveLength(1);
    expect(events[0].metadata).toMatchObject({ recipient: "Jonas" });
  });

  it("leaves activity alone when the sender turns logging off", async () => {
    await spend("4800");
    await sendReminder(fixture.group.access, {
      toParticipantId: fixture.debtor.participantId,
      message: "A nudge.",
      logToActivity: false,
    });

    const events = await getDb()
      .select()
      .from(activityEvents)
      .where(eq(activityEvents.action, "reminder.sent"));
    expect(events).toHaveLength(0);
  });

  it("delivers a notification carrying the sender's own words", async () => {
    await subscribeDevice(fixture.debtor.actor.userId);
    await spend("4800");
    await sendReminder(fixture.group.access, {
      toParticipantId: fixture.debtor.participantId,
      message: "Gentle nudge: €24.00 is quietly waiting to reach Seb.",
      logToActivity: true,
    });

    const inbox = await listNotifications(fixture.debtor.actor.userId);
    const reminder = inbox.find((entry) => entry.type === "reminder.received");
    expect(reminder).toBeDefined();
    expect(reminder!.payload as ReminderPayload).toMatchObject({
      kind: "reminder",
      groupName: "Portugal, March",
      creditorName: "Seb",
      message: "Gentle nudge: €24.00 is quietly waiting to reach Seb.",
    });
  });

  it("writes no notification when the message goes out by hand", async () => {
    await spend("4800");
    await sendReminder(fixture.group.access, {
      toParticipantId: fixture.debtor.participantId,
      message: "A nudge.",
      logToActivity: true,
    });

    const inbox = await listNotifications(fixture.debtor.actor.userId);
    expect(inbox.filter((entry) => entry.type === "reminder.received")).toEqual(
      [],
    );
  });
});

describe("the limits", () => {
  it("refuses a second reminder inside a day", async () => {
    await spend("4800");
    const send = () =>
      sendReminder(fixture.group.access, {
        toParticipantId: fixture.debtor.participantId,
        message: "A nudge.",
        logToActivity: false,
      });

    await send();
    await expect(send()).rejects.toThrow(ReminderError);

    const rows = await getDb().select().from(reminders);
    expect(rows).toHaveLength(1);
  });

  it("allows another once the day has passed", async () => {
    await spend("4800");
    const yesterday = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await sendReminder(
      fixture.group.access,
      {
        toParticipantId: fixture.debtor.participantId,
        message: "A nudge.",
        logToActivity: false,
      },
      { now: yesterday },
    );

    await expect(
      sendReminder(fixture.group.access, {
        toParticipantId: fixture.debtor.participantId,
        message: "Another nudge.",
        logToActivity: false,
      }),
    ).resolves.toMatchObject({ recipientName: "Jonas" });
  });

  /**
   * The recipient list is rebuilt inside the service, so a participant id that
   * never appeared on the sender's screen cannot be talked into a reminder.
   */
  it("refuses to remind somebody who owes nothing", async () => {
    const stranger = await addTestParticipant(fixture.group.groupId, "Robin");
    await spend("4800");

    await expect(
      sendReminder(fixture.group.access, {
        toParticipantId: stranger,
        message: "A nudge.",
        logToActivity: false,
      }),
    ).rejects.toThrow(ReminderError);
  });

  it("refuses an empty message", async () => {
    await spend("4800");
    await expect(
      sendReminder(fixture.group.access, {
        toParticipantId: fixture.debtor.participantId,
        message: "   ",
        logToActivity: false,
      }),
    ).rejects.toThrow(ReminderError);
  });
});
