import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { guestInvitations, participants } from "@/lib/db/schema";
import {
  InvalidInvitationError,
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { createInvitation, revokeInvitation } from "@/modules/groups/service";
import { claimGuestSession } from "@/modules/guests/service";
import { redeemInvitationAs } from "@/modules/join/redeem";
import { claimMember } from "@/modules/join/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * What a retired personal link says about itself.
 *
 * Two retirements look the same from the outside — the owner revoked it, or
 * the person it was sent to made an account — and only the second has an
 * answer other than "ask for a fresh one": sign in. The refusal carries which
 * it was, so the dead-link screen can say so.
 */
describe("a personal link after its guest claimed an account", () => {
  it("says it was claimed, not merely that it no longer works", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const grace = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: grace,
    });
    const redeemed = await redeemInvitation(invitation.token);
    const account = await createTestUser();
    const claim = await claimGuestSession(account.userId, redeemed.token);
    expect(claim.status).toBe("claimed");

    const refusal = await redeemInvitation(invitation.token).catch(
      (error: unknown) => error,
    );

    expect(refusal).toBeInstanceOf(InvalidInvitationError);
    expect((refusal as InvalidInvitationError).reason).toBe("claimed");
  });

  it("keeps a link the owner revoked as merely invalid", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const grace = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: grace,
    });
    await revokeInvitation(group.access, grace);

    const refusal = await redeemInvitation(invitation.token).catch(
      (error: unknown) => error,
    );

    expect((refusal as InvalidInvitationError).reason).toBe("invalid");
  });

  it("calls a token nobody issued invalid", async () => {
    const refusal = await redeemInvitation("not-a-token").catch(
      (error: unknown) => error,
    );
    expect((refusal as InvalidInvitationError).reason).toBe("invalid");
  });
});

/**
 * The same retirement, when the seat is claimed some other way than from the
 * guest's own browser.
 *
 * The native app takes a personal link with `POST /api/join/<token>`, and the
 * group-wide link lets an account pick a listed name. Both link the seat in
 * `claimMember`, which used to leave the seat's personal link live: the URL —
 * no expiry, by default — went on minting guest sessions acting as the
 * account's participant, and the People screen, showing the seat as an
 * account now, offered nobody a way to revoke it.
 */
describe("a personal link after its seat was claimed through a join", () => {
  async function seatWithLink() {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const grace = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: grace,
    });
    // Opened once in a browser before the claim, as a link sent in a chat is.
    const earlier = await redeemInvitation(invitation.token);
    return { group, grace, invitation, earlierSession: earlier.token };
  }

  it("stops opening once the app has taken it with an account", async () => {
    const { invitation, earlierSession } = await seatWithLink();
    const account = await createTestUser();

    await redeemInvitationAs({
      token: invitation.token,
      userId: account.userId,
    });

    const refusal = await redeemInvitation(invitation.token).catch(
      (error: unknown) => error,
    );
    expect((refusal as InvalidInvitationError).reason).toBe("claimed");
    await expect(resolveGuestSession(earlierSession)).resolves.toBeNull();
  });

  it("stops opening once an account picked the name from the group link", async () => {
    const { group, grace, invitation, earlierSession } = await seatWithLink();
    const account = await createTestUser();

    await expect(
      claimMember({
        groupId: group.groupId,
        participantId: grace,
        userId: account.userId,
      }),
    ).resolves.toMatchObject({ status: "joined" });

    await expect(redeemInvitation(invitation.token)).rejects.toBeInstanceOf(
      InvalidInvitationError,
    );
    await expect(resolveGuestSession(earlierSession)).resolves.toBeNull();
    const [row] = await getDb()
      .select({ revokedAt: guestInvitations.revokedAt })
      .from(guestInvitations)
      .where(eq(guestInvitations.id, invitation.invitationId));
    expect(row?.revokedAt).not.toBeNull();
  });

  it("refuses a link left live on a seat that has an account anyway", async () => {
    // What a claim made before the fix left behind: the row says live, the
    // seat says account. The seat wins, for the link and for its sessions.
    const { grace, invitation, earlierSession } = await seatWithLink();
    const account = await createTestUser();
    await getDb()
      .update(participants)
      .set({ userId: account.userId })
      .where(eq(participants.id, grace));

    const refusal = await redeemInvitation(invitation.token).catch(
      (error: unknown) => error,
    );
    expect((refusal as InvalidInvitationError).reason).toBe("claimed");
    await expect(resolveGuestSession(earlierSession)).resolves.toBeNull();
  });
});
