import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  groupJoinLinks,
  groups,
  guestInvitations,
  guestSessions,
  participants,
} from "@/lib/db/schema";
import { createJoinLink, revokeJoinLink } from "@/lib/security/join-link";
import { GROUP_ICONS, GROUP_ICON_COLORS } from "@/modules/groups/icons";
import { createInvitation, revokeInvitation } from "@/modules/groups/service";
import {
  JoinLinkRefused,
  previewGroupLink,
  previewInvitation,
  redeemGroupLink,
  redeemInvitationAs,
} from "./redeem";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../../../tests/helpers/factories";

/**
 * The native client's half of the join flow, against a real PostgreSQL.
 *
 * The property under test is the one the whole design turns on and the one no
 * unit test can see: **reading a link must not take it.** On the web the two
 * are the same request — opening `/join/g/<token>` spends the token — so an app
 * that fetched the web URL to find out what it had would have joined by
 * accident. Everything below either checks that reading changes nothing, or
 * checks that taking is safe to repeat.
 *
 * The claim guard is the other reason this needs a database: it is a
 * conditional UPDATE decided by PostgreSQL when two accounts race for one seat,
 * and a mock would let both win.
 */

async function lastUsedOfLink(groupId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ lastUsedAt: groupJoinLinks.lastUsedAt })
    .from(groupJoinLinks)
    .where(eq(groupJoinLinks.groupId, groupId))
    .limit(1);
  return row?.lastUsedAt ?? null;
}

async function participantCount(groupId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: participants.id })
    .from(participants)
    .where(eq(participants.groupId, groupId));
  return rows.length;
}

describe("previewing a group-wide link", () => {
  it("describes the group without spending the link", async () => {
    const owner = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(owner, { name: "Lisbon, March" });
    await addTestParticipant(group.groupId, "Bruno");
    const link = await createJoinLink(group.groupId, {
      createdByUserId: owner.userId,
    });

    const before = await participantCount(group.groupId);
    const preview = await previewGroupLink(link.token, null);

    expect(preview.groupId).toBe(group.groupId);
    expect(preview.groupName).toBe("Lisbon, March");
    expect(preview.invitedBy).toBe("Amélie");
    expect(preview.memberCount).toBe(2);
    // Nobody is named by a group-wide link — that is what /join/start is for.
    expect(preview.participantName).toBeNull();

    // The three ways reading could have taken it.
    expect(await lastUsedOfLink(group.groupId)).toBeNull();
    expect(await participantCount(group.groupId)).toBe(before);
    expect(preview.alreadyMember).toBe(false);
  });

  it("is safe to call twice", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);

    const first = await previewGroupLink(link.token, null);
    const second = await previewGroupLink(link.token, null);

    expect(second).toEqual(first);
    expect(await lastUsedOfLink(group.groupId)).toBeNull();
  });

  it("knows the reader is already in the group", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);

    const preview = await previewGroupLink(link.token, owner.userId);

    expect(preview.alreadyMember).toBe(true);
  });

  it("agrees with what taking the link would do for a removed member", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, group.ownerParticipantId));

    const preview = await previewGroupLink(link.token, owner.userId);
    const taken = await redeemGroupLink({
      token: link.token,
      userId: owner.userId,
      displayName: owner.name,
    });

    // Neither half restores a removed seat, so the preview must not offer a
    // join that comes back as a no-op — the app would route to a group the
    // account cannot open.
    expect(preview.alreadyMember).toBe(true);
    expect(taken.participantId).toBe(group.ownerParticipantId);
  });

  it("carries the group's icon and accent, in the DTO's own vocabulary", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    // Real slugs from `modules/groups/icons`, not plausible-looking ones: the
    // preview is where a client learns this vocabulary, and a test asserting a
    // value the pickers cannot produce would document the wrong one.
    await getDb()
      .update(groups)
      .set({ icon: GROUP_ICONS[0], iconColor: GROUP_ICON_COLORS[0] })
      .where(eq(groups.id, group.groupId));
    const link = await createJoinLink(group.groupId);

    const preview = await previewGroupLink(link.token, null);

    expect(preview.icon).toBe("plane");
    expect(preview.iconColor).toBe("coral");
  });

  it.each([
    ["a token nobody minted", "invalid"],
    ["a malformed token", "invalid"],
  ])("refuses %s", async (_label, code) => {
    const token =
      code === "invalid" ? "Zm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyZm9vYmFyNDI" : "x";
    await expect(previewGroupLink(token, null)).rejects.toMatchObject({ code });
  });

  it("separates a revoked link from an expired one", async () => {
    const owner = await createTestUser();
    const revokedGroup = await createTestGroup(owner);
    const revoked = await createJoinLink(revokedGroup.groupId);
    await revokeJoinLink(revokedGroup.groupId);

    const expiredGroup = await createTestGroup(owner);
    const expired = await createJoinLink(expiredGroup.groupId, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(previewGroupLink(revoked.token, null)).rejects.toMatchObject({
      code: "revoked",
    });
    await expect(previewGroupLink(expired.token, null)).rejects.toMatchObject({
      code: "expired",
    });
  });

  it("reads an archived group as a link that was turned off", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);
    await getDb()
      .update(groups)
      .set({ archivedAt: new Date() })
      .where(eq(groups.id, group.groupId));

    // Deliberate: saying "archived" would confirm the group exists.
    await expect(previewGroupLink(link.token, null)).rejects.toMatchObject({
      code: "revoked",
    });
  });
});

describe("taking a group-wide link", () => {
  it("adds the caller under their account name", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);
    const joiner = await createTestUser({ name: "Chloé" });

    const result = await redeemGroupLink({
      token: link.token,
      userId: joiner.userId,
      displayName: joiner.name,
    });

    expect(result.groupId).toBe(group.groupId);
    const [row] = await getDb()
      .select({ displayName: participants.displayName })
      .from(participants)
      .where(eq(participants.id, result.participantId));
    expect(row.displayName).toBe("Chloé");
  });

  it("claims a seat the group was already keeping", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const link = await createJoinLink(group.groupId);
    const joiner = await createTestUser();

    const before = await participantCount(group.groupId);
    const result = await redeemGroupLink({
      token: link.token,
      userId: joiner.userId,
      participantId: seat,
      displayName: joiner.name,
    });

    // Claimed, not duplicated: Bruno's history stays Bruno's.
    expect(result.participantId).toBe(seat);
    expect(await participantCount(group.groupId)).toBe(before);
  });

  it("answers a second take with the same seat rather than a conflict", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);
    const joiner = await createTestUser();

    const first = await redeemGroupLink({
      token: link.token,
      userId: joiner.userId,
      displayName: joiner.name,
    });
    const second = await redeemGroupLink({
      token: link.token,
      userId: joiner.userId,
      displayName: joiner.name,
    });

    // A double tap is not a failure, and it does not add a second seat.
    expect(second).toEqual(first);
    expect(await participantCount(group.groupId)).toBe(2);
  });

  it("refuses a seat another account already holds", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const link = await createJoinLink(group.groupId);
    const stranger = await createTestUser();

    await expect(
      redeemGroupLink({
        token: link.token,
        userId: stranger.userId,
        participantId: group.ownerParticipantId,
        displayName: stranger.name,
      }),
    ).rejects.toMatchObject({ code: "taken" });
  });
});

describe("previewing a personal invitation", () => {
  it("names the seat it is holding, and spends nothing", async () => {
    const owner = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(owner, { name: "Lisbon, March" });
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });

    const preview = await previewInvitation(invitation.token, null);

    expect(preview.groupId).toBe(group.groupId);
    expect(preview.groupName).toBe("Lisbon, March");
    expect(preview.participantName).toBe("Bruno");
    expect(preview.invitedBy).toBe("Amélie");

    // Reading must not mint the guest session the web route mints.
    const sessions = await getDb()
      .select({ id: guestSessions.id })
      .from(guestSessions)
      .where(eq(guestSessions.groupId, group.groupId));
    expect(sessions).toEqual([]);

    const [row] = await getDb()
      .select({ lastUsedAt: guestInvitations.lastUsedAt })
      .from(guestInvitations)
      .where(eq(guestInvitations.participantId, seat));
    expect(row.lastUsedAt).toBeNull();
  });

  it("refuses a revoked invitation", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });

    await revokeInvitation(group.access, seat);

    await expect(
      previewInvitation(invitation.token, null),
    ).rejects.toMatchObject({ code: "revoked" });
  });

  it("refuses an expired invitation", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
      expiresInDays: 1,
    });

    await expect(
      previewInvitation(invitation.token, null, {
        now: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
      }),
    ).rejects.toMatchObject({ code: "expired" });
  });

  it("refuses an invitation whose seat was removed", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });

    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, seat));

    await expect(
      previewInvitation(invitation.token, null),
    ).rejects.toMatchObject({ code: "revoked" });
  });
});

describe("taking a personal invitation", () => {
  it("puts the caller in the seat the token names", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });
    const joiner = await createTestUser();

    const result = await redeemInvitationAs({
      token: invitation.token,
      userId: joiner.userId,
    });

    expect(result).toEqual({ groupId: group.groupId, participantId: seat });
  });

  it("mints no guest session — the caller has an account", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });
    const joiner = await createTestUser();

    await redeemInvitationAs({
      token: invitation.token,
      userId: joiner.userId,
    });

    const sessions = await getDb()
      .select({ id: guestSessions.id })
      .from(guestSessions)
      .where(eq(guestSessions.groupId, group.groupId));
    expect(sessions).toEqual([]);
  });

  it("answers a second take with the same seat", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });
    const joiner = await createTestUser();

    const first = await redeemInvitationAs({
      token: invitation.token,
      userId: joiner.userId,
    });
    const second = await redeemInvitationAs({
      token: invitation.token,
      userId: joiner.userId,
    });

    expect(second).toEqual(first);
  });

  it("refuses an invitation minted for a different account", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const seat = await addTestParticipant(group.groupId, "Bruno");
    const invitation = await createInvitation(group.access, {
      participantId: seat,
    });
    const bruno = await createTestUser();
    const stranger = await createTestUser();

    await redeemInvitationAs({ token: invitation.token, userId: bruno.userId });

    // The link still resolves; the seat is simply not on offer any more.
    await expect(
      redeemInvitationAs({ token: invitation.token, userId: stranger.userId }),
    ).rejects.toBeInstanceOf(JoinLinkRefused);
    await expect(
      redeemInvitationAs({ token: invitation.token, userId: stranger.userId }),
    ).rejects.toMatchObject({ code: "taken" });
  });
});
