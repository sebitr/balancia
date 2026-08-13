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
  listNotifications,
  markRead,
  savePreferences,
  setGroupMuted,
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
