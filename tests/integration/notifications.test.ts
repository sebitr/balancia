import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { groupMembers, notifications, participants } from "@/lib/db/schema";
import type { UserActor } from "@/lib/security/authorization";
import { authorizeGroup } from "@/lib/security/authorization";
import {
  createExpense,
  deleteExpense,
  updateExpense,
} from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
import {
  countUnread,
  listInbox,
  listMutedGroups,
  listNotifications,
  listQuietGroups,
  markRead,
  savePreferences,
  setGroupMuted,
  setGroupSnoozed,
} from "@/modules/notifications/service";
import type { SettlementPayload } from "@/modules/notifications/types";
import {
  createTestGroup,
  createTestUser,
  addTestParticipant,
  isoToday,
} from "../helpers/factories";

/**
 * Who gets told what.
 *
 * The interesting behaviour is not "a row was written" but the filtering
 * around it: the actor is left out, people the change does not touch are left
 * out, guests have nowhere to be reached, and both switches (category and
 * group mute) stop the row being written at all rather than hiding it later.
 */

/** A second registered user, joined to an existing group as a real member. */
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

interface Fixture {
  owner: UserActor;
  group: Awaited<ReturnType<typeof createTestGroup>>;
  member: { actor: UserActor; participantId: string };
}

async function setup(): Promise<Fixture> {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, { name: "Trip to Lisbon" });
  const member = await addTestMember(group.groupId, "Blaise");
  return { owner, group, member };
}

function expenseInput(
  fixture: Fixture,
  overrides: Record<string, unknown> = {},
) {
  return {
    description: "Dinner",
    notes: "",
    category: "",
    amount: "4800",
    currency: "EUR",
    exchangeRate: "",
    payers: [
      { participantId: fixture.group.ownerParticipantId, amount: "4800" },
    ],
    splitMethod: "equal" as const,
    splitEntries: [
      { participantId: fixture.group.ownerParticipantId },
      { participantId: fixture.member.participantId },
    ],
    expenseDate: isoToday(),
    ...overrides,
  };
}

let fixture: Fixture;

beforeEach(async () => {
  fixture = await setup();
});

describe("expense notifications", () => {
  it("tells the other people in the split, never the person who acted", async () => {
    await createExpense(fixture.group.access, expenseInput(fixture));

    const forMember = await listNotifications(fixture.member.actor.userId);
    const forActor = await listNotifications(fixture.owner.userId);

    expect(forMember).toHaveLength(1);
    expect(forMember[0].type).toBe("expense.created");
    expect(forMember[0].actorLabel).toBe("Ada");
    expect(forMember[0].payload).toMatchObject({
      kind: "expense",
      groupName: "Trip to Lisbon",
      description: "Dinner",
      amount: "4800",
      currency: "EUR",
    });
    expect(forActor).toHaveLength(0);
  });

  it("leaves out a member the expense does not involve", async () => {
    const bystander = await addTestMember(fixture.group.groupId, "Curie");

    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(bystander.actor.userId)).toHaveLength(0);
  });

  it("writes nothing for a participant with no account", async () => {
    const guestParticipant = await addTestParticipant(
      fixture.group.groupId,
      "Guest",
    );

    await createExpense(
      fixture.group.access,
      expenseInput(fixture, {
        splitEntries: [
          { participantId: fixture.group.ownerParticipantId },
          { participantId: guestParticipant },
        ],
      }),
    );

    // Nothing was written for anyone: the only other party has no account.
    const db = getDb();
    const all = await db.select().from(notifications);
    expect(all).toHaveLength(0);
  });

  it("tells someone dropped from a split that it changed", async () => {
    const expenseId = await createExpense(
      fixture.group.access,
      expenseInput(fixture),
    );
    await markRead(fixture.member.actor.userId);

    // Re-split so only the payer has a share; Blaise is no longer involved.
    await updateExpense(
      fixture.group.access,
      expenseId,
      expenseInput(fixture, {
        splitEntries: [{ participantId: fixture.group.ownerParticipantId }],
      }),
    );

    const unread = await listNotifications(fixture.member.actor.userId);
    expect(unread.filter((entry) => entry.readAt === null)).toHaveLength(1);
    expect(unread[0].type).toBe("expense.updated");
  });

  it("announces a deletion to the people who had a share", async () => {
    const expenseId = await createExpense(
      fixture.group.access,
      expenseInput(fixture),
    );

    await deleteExpense(fixture.group.access, expenseId);

    const entries = await listNotifications(fixture.member.actor.userId);
    expect(entries.map((entry) => entry.type)).toEqual([
      "expense.deleted",
      "expense.created",
    ]);
  });
});

describe("settlement notifications", () => {
  it("words the payment from the reader's side", async () => {
    // Blaise pays Ada; Ada is the actor, so only Blaise's side is written.
    const memberAccess = await authorizeGroup(
      fixture.member.actor,
      fixture.group.groupId,
    );

    await createSettlement(memberAccess, {
      fromParticipantId: fixture.member.participantId,
      toParticipantId: fixture.group.ownerParticipantId,
      amount: "2400",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

    const forOwner = await listNotifications(fixture.owner.userId);
    expect(forOwner).toHaveLength(1);
    const payload = forOwner[0].payload as SettlementPayload;
    expect(payload.direction).toBe("incoming");
    expect(payload.counterpartName).toBe("Blaise");
    expect(payload.amount).toBe("2400");

    // The payer acted, so they are not told about their own payment.
    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      0,
    );
  });
});

describe("preferences and mutes", () => {
  it("writes nothing for a category that is switched off", async () => {
    await savePreferences(fixture.member.actor.userId, {
      expenses: false,
      settlements: true,
      recurring: true,
      imports: true,
      reminders: true,
    });

    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      0,
    );
  });

  it("still notifies about categories that are left on", async () => {
    await savePreferences(fixture.member.actor.userId, {
      expenses: false,
      settlements: true,
      recurring: true,
      imports: true,
      reminders: true,
    });

    await createSettlement(fixture.group.access, {
      fromParticipantId: fixture.group.ownerParticipantId,
      toParticipantId: fixture.member.participantId,
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });

    const entries = await listNotifications(fixture.member.actor.userId);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("settlement.created");
  });

  it("writes nothing at all for a muted group", async () => {
    await setGroupMuted(
      fixture.member.actor.userId,
      fixture.group.groupId,
      true,
    );

    await createExpense(fixture.group.access, expenseInput(fixture));

    // Muting suppresses the row, rather than hiding one that was written.
    const db = getDb();
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, fixture.member.actor.userId));
    expect(rows).toHaveLength(0);
  });

  it("resumes once the group is unmuted", async () => {
    await setGroupMuted(
      fixture.member.actor.userId,
      fixture.group.groupId,
      true,
    );
    await createExpense(fixture.group.access, expenseInput(fixture));
    await setGroupMuted(
      fixture.member.actor.userId,
      fixture.group.groupId,
      false,
    );
    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      1,
    );
  });
});

describe("the inbox", () => {
  it("counts and clears unread for one reader only", async () => {
    await createExpense(fixture.group.access, expenseInput(fixture));
    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await countUnread(fixture.member.actor.userId)).toBe(2);
    expect(await countUnread(fixture.owner.userId)).toBe(0);

    const marked = await markRead(fixture.member.actor.userId);

    expect(marked).toBe(2);
    expect(await countUnread(fixture.member.actor.userId)).toBe(0);
  });

  it("will not let one reader mark another's notifications read", async () => {
    await createExpense(fixture.group.access, expenseInput(fixture));
    const [entry] = await listNotifications(fixture.member.actor.userId);

    // The owner naming someone else's notification id changes nothing.
    const marked = await markRead(fixture.owner.userId, [entry.id]);

    expect(marked).toBe(0);
    expect(await countUnread(fixture.member.actor.userId)).toBe(1);
  });
});

/**
 * A group quietened until tomorrow.
 *
 * A snooze is a mute with an hour on it, and it works the same way: the row is
 * never written, so nothing piles up waiting for the silence to lift. What is
 * worth checking is the seam between the two — they share one row, and a
 * "Resume" beside a snooze must not undo a mute somebody made deliberately.
 */
describe("snoozing a group", () => {
  const inADay = () => new Date(Date.now() + 24 * 60 * 60 * 1000);

  it("writes nothing while the snooze is running", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      inADay(),
    );

    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      0,
    );
  });

  /** The hour passes and the group is audible again, with nothing swept. */
  it("lets everything through once the hour has passed", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      new Date(Date.now() - 1000),
    );

    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      1,
    );
  });

  it("lifts early when the reader resumes it", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      inADay(),
    );
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      null,
    );

    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      1,
    );
  });

  /**
   * Resume is offered beside a snooze, never beside a mute — but the two are
   * one row, so a delete that did not say which shape it wanted would quietly
   * unmute a group the reader muted on purpose.
   */
  it("leaves a mute alone when a snooze is lifted", async () => {
    await setGroupMuted(
      fixture.member.actor.userId,
      fixture.group.groupId,
      true,
    );
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      null,
    );

    await createExpense(fixture.group.access, expenseInput(fixture));

    expect(await listNotifications(fixture.member.actor.userId)).toHaveLength(
      0,
    );
  });

  /** Muting outright is the stronger decision and replaces a running snooze. */
  it("becomes indefinite when the group is muted instead", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      inADay(),
    );
    await setGroupMuted(
      fixture.member.actor.userId,
      fixture.group.groupId,
      true,
    );

    expect(await listMutedGroups(fixture.member.actor.userId)).toEqual([
      fixture.group.groupId,
    ]);
  });

  /**
   * The settings screen lists standing decisions with a switch beside each.
   * Something that undoes itself tomorrow morning does not belong there.
   */
  it("stays out of the muted-groups list on the settings screen", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      inADay(),
    );

    expect(await listMutedGroups(fixture.member.actor.userId)).toEqual([]);
    expect(await listQuietGroups(fixture.member.actor.userId)).toHaveLength(1);
  });

  /** A group with nothing left in the inbox still has to be nameable. */
  it("names the group it quietened, which has no rows left to read it off", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      inADay(),
    );

    const [quiet] = await listQuietGroups(fixture.member.actor.userId);

    expect(quiet.groupId).toBe(fixture.group.groupId);
    expect(quiet.groupName).toBeTruthy();
    expect(quiet.snoozedUntil).not.toBeNull();
  });

  /** A spent row suppresses nothing and is not reported as quiet. */
  it("stops reporting a group whose snooze has run out", async () => {
    await setGroupSnoozed(
      fixture.member.actor.userId,
      fixture.group.groupId,
      new Date(Date.now() - 1000),
    );

    expect(await listQuietGroups(fixture.member.actor.userId)).toEqual([]);
  });
});

/**
 * Where the inbox stops and the archive begins.
 *
 * Age alone does not archive anything: an unread row is one nobody has looked
 * at, and however old it is, it is still the thing the reader came for. What
 * ages out is the read half, kept only so it can be found again.
 */
describe("the archive line", () => {
  const longAgo = new Date("2026-01-01T09:00:00Z");

  /** Backdates a reader's rows and marks them read, as time would have. */
  async function ageAndRead(userId: string): Promise<void> {
    const db = getDb();
    await db
      .update(notifications)
      .set({ createdAt: longAgo, readAt: longAgo })
      .where(eq(notifications.userId, userId));
  }

  it("moves read rows past thirty days into the archive", async () => {
    await createExpense(fixture.group.access, expenseInput(fixture));
    await ageAndRead(fixture.member.actor.userId);

    const inbox = await listInbox(fixture.member.actor.userId);

    expect(inbox.entries).toHaveLength(0);
    expect(inbox.archived).toHaveLength(1);
  });

  it("keeps an unread row in the list however old it is", async () => {
    await createExpense(fixture.group.access, expenseInput(fixture));
    const db = getDb();
    await db
      .update(notifications)
      .set({ createdAt: longAgo })
      .where(eq(notifications.userId, fixture.member.actor.userId));

    const inbox = await listInbox(fixture.member.actor.userId);

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.archived).toHaveLength(0);
  });

  /**
   * The limit is what the inbox is for. A quiet month of read rows must not
   * fill the page and push the recent ones off the end of it.
   */
  it("does not spend the page's limit on archived rows", async () => {
    await createExpense(fixture.group.access, expenseInput(fixture));
    await ageAndRead(fixture.member.actor.userId);
    await createExpense(fixture.group.access, expenseInput(fixture));

    const inbox = await listInbox(fixture.member.actor.userId, { limit: 1 });

    expect(inbox.entries).toHaveLength(1);
    expect(inbox.entries[0].readAt).toBeNull();
  });
});
