import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  groupMembers,
  guestInvitations,
  guestSessions,
  participants,
} from "@/lib/db/schema";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { authorizeGroup, type GuestActor } from "@/lib/security/authorization";
import { createInvitation } from "@/modules/groups/service";
import { createExpense } from "@/modules/expenses/service";
import {
  claimGuestSession,
  countContributions,
  describeGuestSession,
  listContributions,
} from "@/modules/guests/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Turning a guest into a member.
 *
 * The promise the confirmation screen makes out loud — your group, your
 * balance and the expenses you added come with you, and the old link stops
 * working — is the promise these tests hold to.
 */

async function guestActorFor(token: string): Promise<GuestActor> {
  const session = await resolveGuestSession(token);
  if (!session) throw new Error("Expected a live guest session");
  return {
    kind: "guest",
    groupId: session.groupId,
    participantId: session.participantId,
    displayName: session.displayName,
    sessionId: session.sessionId,
  };
}

/** A group with one guest who has already redeemed their link. */
async function groupWithGuest(guestName = "Grace") {
  const owner = await createTestUser();
  const group = await createTestGroup(owner);
  const guestParticipantId = await addTestParticipant(group.groupId, guestName);
  const invitation = await createInvitation(group.access, {
    participantId: guestParticipantId,
  });
  const redeemed = await redeemInvitation(invitation.token);
  return { owner, group, guestParticipantId, invitation, redeemed };
}

describe("claiming a guest session", () => {
  it("links the participant to the account and grants membership", async () => {
    const { group, guestParticipantId, redeemed } = await groupWithGuest();
    const newcomer = await createTestUser({ name: "Grace Hopper" });

    const outcome = await claimGuestSession(newcomer.userId, redeemed.token);

    expect(outcome).toEqual({ status: "claimed", groupId: group.groupId });

    const db = getDb();
    const [participant] = await db
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.id, guestParticipantId));
    expect(participant.userId).toBe(newcomer.userId);

    const [membership] = await db
      .select({
        role: groupMembers.role,
        participantId: groupMembers.participantId,
      })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, group.groupId),
          eq(groupMembers.userId, newcomer.userId),
        ),
      );
    expect(membership.role).toBe("member");
    // The same participant row, so the balance is the one they already had.
    expect(membership.participantId).toBe(guestParticipantId);

    // And the group now opens as a member rather than as a guest.
    const access = await authorizeGroup(newcomer, group.groupId);
    expect(access.role).toBe("member");
    expect(access.participantId).toBe(guestParticipantId);
  });

  it("retires the link and every session derived from it", async () => {
    const { invitation, redeemed } = await groupWithGuest();
    const newcomer = await createTestUser();

    // A second device on the same link, to prove the cascade reaches it.
    const secondDevice = await redeemInvitation(invitation.token);

    await claimGuestSession(newcomer.userId, redeemed.token);

    const db = getDb();
    const [link] = await db
      .select({ revokedAt: guestInvitations.revokedAt })
      .from(guestInvitations)
      .where(eq(guestInvitations.id, invitation.invitationId));
    expect(link.revokedAt).not.toBeNull();

    const sessions = await db
      .select({ revokedAt: guestSessions.revokedAt })
      .from(guestSessions)
      .where(eq(guestSessions.invitationId, invitation.invitationId));
    expect(sessions).toHaveLength(2);
    expect(sessions.every((session) => session.revokedAt !== null)).toBe(true);

    // Neither cookie opens anything any more.
    expect(await resolveGuestSession(redeemed.token)).toBeNull();
    expect(await resolveGuestSession(secondDevice.token)).toBeNull();
  });

  it("keeps the expenses the guest added attributed to them", async () => {
    const { group, guestParticipantId, redeemed } = await groupWithGuest();
    const guestAccess = await authorizeGroup(
      await guestActorFor(redeemed.token),
      group.groupId,
    );

    await createExpense(guestAccess, {
      description: "Groceries and firewood",
      notes: "",
      category: "",
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: guestParticipantId, amount: "1000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: guestParticipantId },
        { participantId: group.ownerParticipantId },
      ],
    });

    const newcomer = await createTestUser();
    await claimGuestSession(newcomer.userId, redeemed.token);

    // The confirmation screen reads these back, after the claim.
    expect(await countContributions(guestParticipantId)).toBe(1);
    const kept = await listContributions(guestParticipantId);
    expect(kept.map((expense) => expense.description)).toEqual([
      "Groceries and firewood",
    ]);
  });

  it("skips the claim when the account is already in the group", async () => {
    const { owner, group, guestParticipantId, redeemed } =
      await groupWithGuest();

    // The owner opens the guest link in their own browser and signs in.
    const outcome = await claimGuestSession(owner.userId, redeemed.token);

    expect(outcome).toEqual({ status: "conflict", groupId: group.groupId });

    const db = getDb();
    const [participant] = await db
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.id, guestParticipantId));
    expect(participant.userId).toBeNull();
    // Nothing was retired either, so the guest identity still works.
    expect(await resolveGuestSession(redeemed.token)).not.toBeNull();
  });

  it("does nothing for a missing, malformed or already claimed cookie", async () => {
    const { redeemed } = await groupWithGuest();
    const newcomer = await createTestUser();
    const other = await createTestUser();

    expect(await claimGuestSession(newcomer.userId, undefined)).toEqual({
      status: "none",
    });
    expect(await claimGuestSession(newcomer.userId, "not-a-token")).toEqual({
      status: "none",
    });

    await claimGuestSession(newcomer.userId, redeemed.token);
    // Replaying the same cookie afterwards must not hand the group to someone
    // else: the session died with the link.
    expect(await claimGuestSession(other.userId, redeemed.token)).toEqual({
      status: "none",
    });
  });
});

describe("describing a guest session", () => {
  it("names whoever created the link", async () => {
    const { owner, redeemed } = await groupWithGuest();
    const session = await guestActorFor(redeemed.token);

    expect(await describeGuestSession(session.sessionId)).toEqual({
      inviterName: owner.name,
    });
  });
});
