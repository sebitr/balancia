import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { guestInvitations, guestSessions } from "@/lib/db/schema";
import {
  InvalidInvitationError,
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import {
  AuthorizationError,
  authorizeGroup,
  type GuestActor,
} from "@/lib/security/authorization";
import { hashToken } from "@/lib/security/tokens";
import {
  createInvitation,
  removeParticipant,
  revokeInvitation,
} from "@/modules/groups/service";
import { createExpense } from "@/modules/expenses/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Guest access: the security-critical path.
 *
 * These tests assert the properties the design promises — the raw token is
 * never stored, a guest is confined to one group, revocation is immediate,
 * and a guest can do the financial things a member can but none of the
 * administrative ones.
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

describe("invitation tokens", () => {
  it("stores only a hash of the token, never the token itself", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");

    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });

    const db = getDb();
    const [row] = await db
      .select()
      .from(guestInvitations)
      .where(eq(guestInvitations.participantId, guest));

    expect(row.tokenHash).toBe(hashToken(invitation.token));
    // The raw token must not appear anywhere in the row.
    expect(JSON.stringify(row)).not.toContain(invitation.token);
    expect(invitation.token.length).toBeGreaterThanOrEqual(40);
  });

  it("never records the raw token in activity metadata", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");

    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });

    const db = getDb();
    const events = await db.query.activityEvents.findMany();
    expect(JSON.stringify(events)).not.toContain(invitation.token);
  });

  it("rejects a token that was never issued", async () => {
    await expect(redeemInvitation("A".repeat(43))).rejects.toThrow(
      InvalidInvitationError,
    );
  });

  it("rejects a malformed token without touching the database", async () => {
    await expect(redeemInvitation("short")).rejects.toThrow(
      InvalidInvitationError,
    );
  });
});

describe("redemption", () => {
  it("exchanges the invitation for a separate session token", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });

    const redeemed = await redeemInvitation(invitation.token);

    // The session token is a different secret from the invitation token.
    expect(redeemed.token).not.toBe(invitation.token);
    expect(redeemed.context.groupId).toBe(group.groupId);
    expect(redeemed.context.participantId).toBe(guest);

    const db = getDb();
    const [session] = await db
      .select()
      .from(guestSessions)
      .where(eq(guestSessions.id, redeemed.context.sessionId));
    expect(session.tokenHash).toBe(hashToken(redeemed.token));
    expect(JSON.stringify(session)).not.toContain(redeemed.token);
  });

  it("records when the link was last used", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });

    await redeemInvitation(invitation.token);

    const db = getDb();
    const [row] = await db
      .select()
      .from(guestInvitations)
      .where(eq(guestInvitations.participantId, guest));
    expect(row.lastUsedAt).not.toBeNull();
  });

  it("refuses an expired invitation", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
      expiresInDays: 1,
    });

    const db = getDb();
    await db
      .update(guestInvitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(guestInvitations.participantId, guest));

    await expect(redeemInvitation(invitation.token)).rejects.toThrow(
      InvalidInvitationError,
    );
  });
});

describe("guest authorization", () => {
  it("grants access to its own group", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });
    const redeemed = await redeemInvitation(invitation.token);
    const guestActor = await guestActorFor(redeemed.token);

    const access = await authorizeGroup(guestActor, group.groupId);
    expect(access.role).toBe("guest");
    expect(access.participantId).toBe(guest);
  });

  it("refuses any other group, even one that exists", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor, { name: "Invited" });
    const otherGroup = await createTestGroup(actor, { name: "Not invited" });
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });
    const redeemed = await redeemInvitation(invitation.token);
    const guestActor = await guestActorFor(redeemed.token);

    await expect(
      authorizeGroup(guestActor, otherGroup.groupId),
    ).rejects.toThrow(AuthorizationError);
  });

  it("can record expenses but cannot manage people, links or the group", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });
    const redeemed = await redeemInvitation(invitation.token);
    const guestActor = await guestActorFor(redeemed.token);
    const guestAccess = await authorizeGroup(guestActor, group.groupId);

    // Allowed: full financial participation.
    expect(guestAccess.permissions.addExpense).toBe(true);
    expect(guestAccess.permissions.editAnyExpense).toBe(true);
    expect(guestAccess.permissions.addSettlement).toBe(true);
    expect(guestAccess.permissions.uploadReceipt).toBe(true);
    expect(guestAccess.permissions.manageRecurring).toBe(true);

    // Refused: anything that would let them escalate.
    expect(guestAccess.permissions.manageParticipants).toBe(false);
    expect(guestAccess.permissions.manageInvitations).toBe(false);
    expect(guestAccess.permissions.manageGroupSettings).toBe(false);
    expect(guestAccess.permissions.deleteGroup).toBe(false);
    expect(guestAccess.permissions.transferOwnership).toBe(false);
    expect(guestAccess.permissions.importData).toBe(false);

    // And the services enforce it, not just the flags.
    const expenseId = await createExpense(guestAccess, {
      description: "Guest expense",
      notes: "",
      category: "",
      amount: "1000",
      currency: "EUR",
      exchangeRate: "",
      expenseDate: isoToday(),
      payers: [{ participantId: guest, amount: "1000" }],
      splitMethod: "equal",
      splitEntries: [
        { participantId: guest },
        { participantId: group.ownerParticipantId },
      ],
    });
    expect(expenseId).toBeTruthy();

    await expect(
      createInvitation(guestAccess, {
        participantId: group.ownerParticipantId,
      }),
    ).rejects.toThrow(AuthorizationError);

    await expect(
      removeParticipant(guestAccess, group.ownerParticipantId),
    ).rejects.toThrow(AuthorizationError);
  });
});

describe("revocation", () => {
  it("kills the link and every session derived from it", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });
    const redeemed = await redeemInvitation(invitation.token);

    // Live before revocation.
    expect(await resolveGuestSession(redeemed.token)).not.toBeNull();

    await revokeInvitation(group.access, guest);

    // Session dead.
    expect(await resolveGuestSession(redeemed.token)).toBeNull();
    // Link dead.
    await expect(redeemInvitation(invitation.token)).rejects.toThrow(
      InvalidInvitationError,
    );
  });

  it("regenerating a link revokes the previous one", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");

    const first = await createInvitation(group.access, {
      participantId: guest,
    });
    const firstSession = await redeemInvitation(first.token);

    const second = await createInvitation(group.access, {
      participantId: guest,
    });

    // The old link and its sessions stop working immediately.
    await expect(redeemInvitation(first.token)).rejects.toThrow(
      InvalidInvitationError,
    );
    expect(await resolveGuestSession(firstSession.token)).toBeNull();

    // The new one works.
    const secondSession = await redeemInvitation(second.token);
    expect(await resolveGuestSession(secondSession.token)).not.toBeNull();
  });

  it("removing the participant revokes their access", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const guest = await addTestParticipant(group.groupId, "Grace");
    const invitation = await createInvitation(group.access, {
      participantId: guest,
    });
    const redeemed = await redeemInvitation(invitation.token);

    await removeParticipant(group.access, guest);

    expect(await resolveGuestSession(redeemed.token)).toBeNull();
  });
});
