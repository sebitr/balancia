import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTranslator } from "use-intl/core";
import { getDb } from "@/lib/db/client";
import { groupMembers, participants, settlements } from "@/lib/db/schema";
import {
  authorizeGroup,
  type GuestActor,
  type UserActor,
} from "@/lib/security/authorization";
import {
  findRestorableDeletions,
  listGroupActivity,
} from "@/modules/activity/service";
import {
  describeActivity,
  type ActivityTranslate,
} from "@/components/activity/describe";
import { createExpense } from "@/modules/expenses/service";
import {
  leaveGroup,
  listGroupsForUser,
  removeParticipant,
  restoreParticipant,
  setGroupArchived,
} from "@/modules/groups/service";
import { createSettlement } from "@/modules/settlements/service";
import en from "../../messages/en.json";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
  type TestGroup,
} from "../helpers/factories";

/**
 * Leaving a group: the owner's removal, asked for by the person it removes.
 *
 * Every guarantee is removal's own — square first, history kept, membership
 * gone — so what is tested here is the door: that a member may open it for
 * themselves and for nobody else, that the owner and a guest are refused, and
 * that what is left behind is what removal leaves, down to the owner's
 * Restore in Activity.
 *
 * Driven through all three ways in: the service, the Server Action the People
 * screen calls, and the route a phone calls.
 */

const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    cookieActor.value?.kind === "user" ? cookieActor.value : null,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

// The action revalidates the dashboard, which needs a request Next would be
// serving; what is under test is what it wrote.
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));

// A refusal is translated by the action funnel, which needs a request too;
// resolved against the shipped English catalogue instead.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof en) => {
    const entries = en[namespace] as Record<string, string>;
    const translate = (key: string) => entries[key] ?? key;
    return Object.assign(translate, {
      has: (key: string) => key in entries,
    });
  },
}));

const participantRoute =
  await import("@/app/api/groups/[groupId]/participants/[participantId]/route");
const { leaveGroupAction } = await import("@/modules/groups/actions");

beforeEach(() => {
  cookieActor.value = null;
});

/** Somebody with an account who joined a group somebody else owns. */
async function addMember(
  groupId: string,
  name = "Grace",
): Promise<{ user: UserActor; participantId: string }> {
  const db = getDb();
  const user = await createTestUser({ name });
  const [participant] = await db
    .insert(participants)
    .values({
      groupId,
      displayName: name,
      email: user.email,
      userId: user.userId,
    })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId,
    userId: user.userId,
    participantId: participant!.id,
    role: "member",
  });
  return { user, participantId: participant!.id };
}

/** Paid by `payer`, split equally between them and `others`. */
function dinner(payer: string, others: readonly string[]) {
  return {
    description: "Dinner",
    notes: "",
    category: "",
    amount: "3000",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: payer, amount: "3000" }],
    splitMethod: "equal" as const,
    splitEntries: [payer, ...others].map((participantId) => ({
      participantId,
    })),
  };
}

/** A member who shared a dinner with the owner and has paid their half back. */
async function squareMember(group: TestGroup) {
  const member = await addMember(group.groupId);
  await createExpense(
    group.access,
    dinner(group.ownerParticipantId, [member.participantId]),
  );
  await createSettlement(group.access, {
    fromParticipantId: member.participantId,
    toParticipantId: group.ownerParticipantId,
    amount: "1500",
    currency: "EUR",
    exchangeRate: "",
    settledOn: isoToday(),
    notes: "",
  });
  return member;
}

async function removedAt(participantId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ removedAt: participants.removedAt })
    .from(participants)
    .where(eq(participants.id, participantId));
  return row?.removedAt ?? null;
}

async function membershipOf(groupId: string, userId: string) {
  const [row] = await getDb()
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    );
  return row ?? null;
}

/** The feed's wording, from the shipped English catalogue. */
function activityWords(): ActivityTranslate {
  return createTranslator({
    locale: "en",
    messages: en,
    namespace: "activity",
  }) as unknown as ActivityTranslate;
}

function context(groupId: string, participantId: string) {
  return { params: Promise.resolve({ groupId, participantId }) } as never;
}

function deleteRequest(): Request {
  return new Request("http://localhost/api/groups/x/participants/y", {
    method: "DELETE",
  });
}

describe("a member leaving", () => {
  it("takes them out once they are square, from the People screen", async () => {
    const owner = await createTestUser({ name: "Seb" });
    const group = await createTestGroup(owner, { name: "Flat" });
    const member = await squareMember(group);
    cookieActor.value = member.user;

    expect(await leaveGroupAction(group.groupId)).toEqual({
      ok: true,
      data: undefined,
    });

    expect(await removedAt(member.participantId)).not.toBeNull();
    expect(await membershipOf(group.groupId, member.user.userId)).toBeNull();
    // The group drops off their list, and they can no longer open it.
    expect(await listGroupsForUser(member.user.userId)).toEqual([]);
    await expect(
      authorizeGroup(member.user, group.groupId),
    ).rejects.toMatchObject({ code: "noGroupAccess" });
    // Nobody else's place changed.
    expect(await listGroupsForUser(owner.userId)).toHaveLength(1);
  });

  it("takes them out over the API, naming their own row", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const member = await squareMember(group);
    cookieActor.value = member.user;

    const response = await participantRoute.DELETE(
      deleteRequest(),
      context(group.groupId, member.participantId),
    );

    expect(response.status).toBe(200);
    expect(await removedAt(member.participantId)).not.toBeNull();
  });

  it("refuses while they owe, in their own words, and leaves them in", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const member = await addMember(group.groupId);
    await createExpense(
      group.access,
      dinner(group.ownerParticipantId, [member.participantId]),
    );
    cookieActor.value = member.user;

    expect(await leaveGroupAction(group.groupId)).toEqual({
      ok: false,
      error: en.serverErrors.selfHasBalance,
    });

    const response = await participantRoute.DELETE(
      deleteRequest(),
      context(group.groupId, member.participantId),
    );
    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error:
        "You still have money outstanding in this group. Settle up first, then leave.",
    });

    expect(await removedAt(member.participantId)).toBeNull();
    expect(await membershipOf(group.groupId, member.user.userId)).toEqual({
      role: "member",
    });
  });

  it("refuses while they are owed, in a currency of its own", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const member = await squareMember(group);
    await createExpense(group.access, {
      ...dinner(member.participantId, [group.ownerParticipantId]),
      currency: "CHF",
    });
    const access = await authorizeGroup(member.user, group.groupId);

    await expect(leaveGroup(access)).rejects.toMatchObject({
      name: "OpenBalanceError",
      code: "selfHasBalance",
    });
    expect(await removedAt(member.participantId)).toBeNull();
  });

  it("refuses in an archived group, which takes no changes", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const member = await squareMember(group);
    await setGroupArchived(group.access, true);
    cookieActor.value = member.user;

    expect(await leaveGroupAction(group.groupId)).toEqual({
      ok: false,
      error: en.serverErrors.groupArchived,
    });
    expect(await removedAt(member.participantId)).toBeNull();
  });
});

describe("who may not leave this way", () => {
  it("refuses the owner, and says what they can do instead", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    cookieActor.value = owner;

    expect(await leaveGroupAction(group.groupId)).toEqual({
      ok: false,
      error: en.serverErrors.ownerCannotLeave,
    });
    expect(await removedAt(group.ownerParticipantId)).toBeNull();
    expect(await membershipOf(group.groupId, owner.userId)).toEqual({
      role: "owner",
    });
  });

  it("refuses a guest, whose seat is the owner's to close", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Hervé");
    const guest: GuestActor = {
      kind: "guest",
      groupId: group.groupId,
      participantId: seat,
      displayName: "Hervé",
      sessionId: randomUUID(),
    };
    const access = await authorizeGroup(guest, group.groupId);

    await expect(leaveGroup(access)).rejects.toMatchObject({
      name: "AuthorizationError",
      code: "noPermission",
    });
    expect(await removedAt(seat)).toBeNull();
  });

  it("does not let a member take anybody else out by naming them", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const member = await squareMember(group);
    const other = await addMember(group.groupId, "Ada");
    const nameOnly = await addTestParticipant(group.groupId, "Cyril");
    cookieActor.value = member.user;

    for (const target of [
      other.participantId,
      nameOnly,
      group.ownerParticipantId,
    ]) {
      const response = await participantRoute.DELETE(
        deleteRequest(),
        context(group.groupId, target),
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ code: "noPermission" });
      expect(await removedAt(target)).toBeNull();
    }

    // The service answers the same, whoever calls it.
    const access = await authorizeGroup(member.user, group.groupId);
    await expect(
      removeParticipant(access, other.participantId),
    ).rejects.toMatchObject({ code: "noPermission" });
    // And they are still in, having asked about everybody but themselves.
    expect(await removedAt(member.participantId)).toBeNull();
  });
});

describe("after somebody has left", () => {
  async function left() {
    const owner = await createTestUser({ name: "Seb" });
    const group = await createTestGroup(owner);
    const member = await squareMember(group);
    await leaveGroup(await authorizeGroup(member.user, group.groupId));
    return { owner, group, member };
  }

  it("tells the group they left, rather than that they removed themselves", async () => {
    const { group, member } = await left();

    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const line = entries.find(
      (entry) => entry.action === "participant.removed",
    );
    expect(line).toMatchObject({
      entityId: member.participantId,
      actorParticipantId: member.participantId,
      actorLabel: "Grace",
    });

    expect(describeActivity(line!, activityWords())).toBe("left the group");
  });

  it("still tells a removal by the owner as one", async () => {
    const owner = await createTestUser({ name: "Seb" });
    const group = await createTestGroup(owner);
    const cyril = await addTestParticipant(group.groupId, "Cyril");
    await removeParticipant(group.access, cyril);

    const [line] = await listGroupActivity(group.groupId, { limit: 1 });
    expect(describeActivity(line!, activityWords())).toBe(
      "removed Cyril from the group",
    );
  });

  it("offers the owner their way back in from Activity, and nobody else", async () => {
    const { group, member } = await left();
    const entries = await listGroupActivity(group.groupId, { limit: 100 });
    const line = entries.find(
      (entry) => entry.action === "participant.removed",
    )!;

    expect(await findRestorableDeletions(group.access, entries)).toEqual(
      new Set([line.id]),
    );

    await restoreParticipant(group.access, member.participantId);

    expect(await removedAt(member.participantId)).toBeNull();
    expect(await membershipOf(group.groupId, member.user.userId)).toEqual({
      role: "member",
    });
    expect(await listGroupsForUser(member.user.userId)).toHaveLength(1);
  });

  it("keeps what they were part of, under their name", async () => {
    const { member } = await left();

    const [row] = await getDb()
      .select({ displayName: participants.displayName })
      .from(participants)
      .where(eq(participants.id, member.participantId));
    expect(row?.displayName).toBe("Grace");
    // The repayment they made stands, still from them.
    const theirs = await getDb()
      .select({ id: settlements.id })
      .from(settlements)
      .where(
        and(
          eq(settlements.fromParticipantId, member.participantId),
          isNull(settlements.deletedAt),
        ),
      );
    expect(theirs).toHaveLength(1);
  });
});
