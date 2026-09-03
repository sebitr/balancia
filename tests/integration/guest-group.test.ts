import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { groupMembers, groups, participants } from "@/lib/db/schema";
import { resolveJoinLink } from "@/lib/security/join-link";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { createGroupAsGuest } from "@/modules/groups/service";
import { claimGuestSession } from "@/modules/guests/service";
import { createTestUser } from "../helpers/factories";

/**
 * A group started by somebody with no account, and what claiming it makes
 * them.
 *
 * Everything here already existed for the invited guest; what is new is a
 * group with nobody on record as its owner, and the rule that the first
 * account to claim the creator's seat becomes that owner.
 */
describe("createGroupAsGuest", () => {
  it("writes a group with no owner, a seat for the creator, and a link", async () => {
    const created = await createGroupAsGuest({
      name: "Lisbon trip",
      displayName: "Dana",
      timezone: "Europe/Lisbon",
      baseCurrency: "EUR",
    });

    const [group] = await getDb()
      .select({
        name: groups.name,
        createdByUserId: groups.createdByUserId,
        currencyMode: groups.currencyMode,
      })
      .from(groups)
      .where(eq(groups.id, created.id));
    expect(group).toEqual({
      name: "Lisbon trip",
      createdByUserId: null,
      currencyMode: "converted",
    });

    const [seat] = await getDb()
      .select({ userId: participants.userId, name: participants.displayName })
      .from(participants)
      .where(eq(participants.id, created.participantId));
    expect(seat).toEqual({ userId: null, name: "Dana" });

    const members = await getDb()
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(eq(groupMembers.groupId, created.id));
    expect(members).toHaveLength(0);

    // The shared link resolves to this group, with nobody as its author.
    const token = created.invite.url.split("/join/g/")[1]!;
    const link = await resolveJoinLink(token);
    expect(link.groupId).toBe(created.id);
    expect(link.inviterName).toBeNull();
  });

  it("leaves the creator holding a guest session for their own seat", async () => {
    const created = await createGroupAsGuest({
      name: "Lisbon trip",
      displayName: "Dana",
      timezone: "Europe/Lisbon",
      baseCurrency: "EUR",
    });

    const redeemed = await redeemInvitation(created.invitationToken);
    const session = await resolveGuestSession(redeemed.token);

    expect(session).toMatchObject({
      groupId: created.id,
      participantId: created.participantId,
      displayName: "Dana",
    });
  });

  it("makes the account that claims the creator's seat the owner", async () => {
    const created = await createGroupAsGuest({
      name: "Lisbon trip",
      displayName: "Dana",
      timezone: "Europe/Lisbon",
      baseCurrency: "EUR",
    });
    const redeemed = await redeemInvitation(created.invitationToken);
    const dana = await createTestUser();

    const claim = await claimGuestSession(dana.userId, redeemed.token);
    expect(claim.status).toBe("claimed");

    const [member] = await getDb()
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, created.id),
          eq(groupMembers.userId, dana.userId),
        ),
      );
    expect(member?.role).toBe("owner");

    const [group] = await getDb()
      .select({ createdByUserId: groups.createdByUserId })
      .from(groups)
      .where(eq(groups.id, created.id));
    expect(group?.createdByUserId).toBe(dana.userId);
  });

  it("still joins a claimed seat in an owned group as a member", async () => {
    // The ordinary case, unchanged: a guest invited into somebody's group
    // does not become its owner by making an account.
    const created = await createGroupAsGuest({
      name: "Lisbon trip",
      displayName: "Dana",
      timezone: "Europe/Lisbon",
      baseCurrency: "EUR",
    });
    const first = await redeemInvitation(created.invitationToken);
    const dana = await createTestUser();
    await claimGuestSession(dana.userId, first.token);

    // A second seat, invited the guest way by nobody in particular.
    const [seat] = await getDb()
      .insert(participants)
      .values({ groupId: created.id, displayName: "Eli" })
      .returning({ id: participants.id });
    const { generateToken } = await import("@/lib/security/tokens");
    const token = generateToken();
    const { guestInvitations } = await import("@/lib/db/schema");
    await getDb().insert(guestInvitations).values({
      groupId: created.id,
      participantId: seat!.id,
      tokenHash: token.hash,
      tokenPrefix: token.prefix,
    });
    const eli = await createTestUser();
    const second = await redeemInvitation(token.raw);

    await claimGuestSession(eli.userId, second.token);

    const [member] = await getDb()
      .select({ role: groupMembers.role })
      .from(groupMembers)
      .where(
        and(
          eq(groupMembers.groupId, created.id),
          eq(groupMembers.userId, eli.userId),
        ),
      );
    expect(member?.role).toBe("member");
  });
});
