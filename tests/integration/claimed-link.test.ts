import { describe, expect, it } from "vitest";
import {
  InvalidInvitationError,
  redeemInvitation,
} from "@/lib/security/guest-session";
import { createInvitation, revokeInvitation } from "@/modules/groups/service";
import { claimGuestSession } from "@/modules/guests/service";
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
