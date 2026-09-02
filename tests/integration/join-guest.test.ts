import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  guestInvitations,
  participants,
} from "@/lib/db/schema";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { joinAsGuest } from "@/modules/join/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * Joining through the group's shared link without an account.
 *
 * The screens offered this and nothing behind them did it: no participant,
 * no invitation, no session, and "Go to the group" opened the sign-in page.
 * What the join has to produce is the same guest the owner could have invited
 * by hand — a participant, a revocable invitation for it, and a token that
 * spends into a session for exactly that participant in exactly that group.
 */
describe("joinAsGuest", () => {
  it("files somebody new under the typed name and mints their way in", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    const outcome = await joinAsGuest({
      groupId: group.groupId,
      participantId: null,
      displayName: "  Dana ",
    });
    if (outcome.status !== "joined") throw new Error("Expected a join");

    const redeemed = await redeemInvitation(outcome.invitationToken);
    const session = await resolveGuestSession(redeemed.token);
    expect(session).toMatchObject({
      groupId: group.groupId,
      participantId: outcome.participantId,
      displayName: "Dana",
    });

    const [row] = await getDb()
      .select({ userId: participants.userId, name: participants.displayName })
      .from(participants)
      .where(eq(participants.id, outcome.participantId));
    expect(row).toEqual({ userId: null, name: "Dana" });
  });

  it("claims a listed name, with the invitation on that participant", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const chris = await addTestParticipant(group.groupId, "Chris");

    const outcome = await joinAsGuest({
      groupId: group.groupId,
      participantId: chris,
      displayName: "ignored",
    });
    if (outcome.status !== "joined") throw new Error("Expected a join");
    expect(outcome.participantId).toBe(chris);

    const [invitation] = await getDb()
      .select({
        participantId: guestInvitations.participantId,
        createdBy: guestInvitations.createdByUserId,
        expiresAt: guestInvitations.expiresAt,
      })
      .from(guestInvitations)
      .where(eq(guestInvitations.participantId, chris));
    expect(invitation).toEqual({
      participantId: chris,
      createdBy: null,
      expiresAt: null,
    });

    const session = await resolveGuestSession(
      (await redeemInvitation(outcome.invitationToken)).token,
    );
    expect(session?.displayName).toBe("Chris");
  });

  it("refuses a listed name that an account took in the meantime", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const chris = await addTestParticipant(group.groupId, "Chris");
    const someone = await createTestUser();
    await getDb()
      .update(participants)
      .set({ userId: someone.userId })
      .where(eq(participants.id, chris));

    const outcome = await joinAsGuest({
      groupId: group.groupId,
      participantId: chris,
      displayName: "Chris",
    });

    expect(outcome).toEqual({ status: "taken" });
    const invitations = await getDb()
      .select({ id: guestInvitations.id })
      .from(guestInvitations)
      .where(eq(guestInvitations.participantId, chris));
    expect(invitations).toHaveLength(0);
  });

  it("refuses a name that belongs to another group", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const other = await createTestGroup(owner);
    const elsewhere = await addTestParticipant(other.groupId, "Elsewhere");

    const outcome = await joinAsGuest({
      groupId: group.groupId,
      participantId: elsewhere,
      displayName: "Elsewhere",
    });

    expect(outcome).toEqual({ status: "taken" });
  });

  it("writes the join into the group's history, without the token", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    const outcome = await joinAsGuest({
      groupId: group.groupId,
      participantId: null,
      displayName: "Dana",
    });
    if (outcome.status !== "joined") throw new Error("Expected a join");

    const [event] = await getDb()
      .select({
        action: activityEvents.action,
        actorType: activityEvents.actorType,
        actorLabel: activityEvents.actorLabel,
        metadata: activityEvents.metadata,
      })
      .from(activityEvents)
      .where(
        and(
          eq(activityEvents.groupId, group.groupId),
          eq(activityEvents.action, "guest_link.created"),
        ),
      );
    expect(event).toMatchObject({
      actorType: "guest",
      actorLabel: "Dana",
      metadata: { via: "join_link", claimed: false },
    });
    expect(JSON.stringify(event)).not.toContain(outcome.invitationToken);
  });
});
