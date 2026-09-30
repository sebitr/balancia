import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb, getPool } from "@/lib/db/client";
import { groupMembers, groups, participants } from "@/lib/db/schema";
import { resolveJoinLink } from "@/lib/security/join-link";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { deleteAccount } from "@/modules/auth/service";
import { createGroupAsGuest } from "@/modules/groups/service";
import { claimGuestSession } from "@/modules/guests/service";
import {
  claimMember,
  joinAsGuest,
  listClaimableMembers,
} from "@/modules/join/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * A group started by somebody with no account, and what claiming it makes
 * them.
 *
 * Everything here already existed for the invited guest; what is new is a
 * group with nobody on record as its owner, and the rule that the first
 * account to claim the creator's seat becomes that owner — the creator's
 * seat, and no other, which is what the second half of this file is about.
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
        createdByParticipantId: groups.createdByParticipantId,
        currencyMode: groups.currencyMode,
      })
      .from(groups)
      .where(eq(groups.id, created.id));
    expect(group).toEqual({
      name: "Lisbon trip",
      createdByUserId: null,
      // The seat whose claim will make an owner.
      createdByParticipantId: created.participantId,
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

/** A guest-started group, with its creator holding their own guest session. */
async function startedByDana() {
  const created = await createGroupAsGuest({
    name: "Lisbon trip",
    displayName: "Dana",
    timezone: "Europe/Lisbon",
    baseCurrency: "EUR",
  });
  const session = await redeemInvitation(created.invitationToken);
  return { created, danaToken: session.token };
}

/** Somebody arriving through the group's shared link, with no account. */
async function guestThroughTheLink(groupId: string, displayName: string) {
  const joined = await joinAsGuest({
    groupId,
    participantId: null,
    displayName,
  });
  if (joined.status !== "joined") throw new Error("Expected a join");
  const session = await redeemInvitation(joined.invitationToken);
  return { participantId: joined.participantId, token: session.token };
}

async function roleOf(groupId: string, userId: string) {
  const [member] = await getDb()
    .select({ role: groupMembers.role })
    .from(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    );
  return member?.role ?? null;
}

async function creatorAccountOf(groupId: string) {
  const [group] = await getDb()
    .select({ createdByUserId: groups.createdByUserId })
    .from(groups)
    .where(eq(groups.id, groupId));
  return group?.createdByUserId ?? null;
}

describe("who owns a group a guest started", () => {
  it("is its creator, even when somebody from the group link signs up first", async () => {
    // The first claim used to take the group whichever seat it was for: Eli,
    // let in through the link, made an account before Dana did and became
    // the owner of Dana's group — its people, its links, its delete button.
    const { created, danaToken } = await startedByDana();
    const eliGuest = await guestThroughTheLink(created.id, "Eli");
    const eli = await createTestUser();

    await expect(
      claimGuestSession(eli.userId, eliGuest.token),
    ).resolves.toMatchObject({ status: "claimed" });

    expect(await roleOf(created.id, eli.userId)).toBe("member");
    expect(await creatorAccountOf(created.id)).toBeNull();

    const dana = await createTestUser();
    await claimGuestSession(dana.userId, danaToken);

    expect(await roleOf(created.id, dana.userId)).toBe("owner");
    expect(await creatorAccountOf(created.id)).toBe(dana.userId);
  });

  it("keeps the creator's seat off the group link while nobody owns the group", async () => {
    // The other way into Dana's seat: pick her name from the link's list of
    // people without an account, and claim it from there.
    const { created } = await startedByDana();
    await addTestParticipant(created.id, "Eli");
    const stranger = await createTestUser();

    const listed = await listClaimableMembers(created.id);
    expect(listed.map((member) => member.displayName)).toEqual(["Eli"]);

    await expect(
      joinAsGuest({
        groupId: created.id,
        participantId: created.participantId,
        displayName: "Dana",
      }),
    ).resolves.toEqual({ status: "taken" });
    await expect(
      claimMember({
        groupId: created.id,
        participantId: created.participantId,
        userId: stranger.userId,
      }),
    ).resolves.toEqual({ status: "taken" });

    const [seat] = await getDb()
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.id, created.participantId));
    expect(seat?.userId).toBeNull();
  });

  it("does not pass a departed creator's seat, or the group, to the next guest", async () => {
    // Dana claims, owns, and later closes her account while Eli is still in
    // the group on his link. The group stays for Eli, with nobody owning it,
    // and Dana's seat is empty again — which must not make it a way to the
    // owner's row for whoever opens the group link next.
    const { created, danaToken } = await startedByDana();
    const dana = await createTestUser();
    await claimGuestSession(dana.userId, danaToken);
    await guestThroughTheLink(created.id, "Eli");

    await deleteAccount(dana.userId);

    const listed = await listClaimableMembers(created.id);
    expect(listed.map((member) => member.displayName)).toEqual(["Eli"]);
    await expect(
      joinAsGuest({
        groupId: created.id,
        participantId: created.participantId,
        displayName: "Dana",
      }),
    ).resolves.toEqual({ status: "taken" });
  });
});

describe("a guest-started group with its creator's seat on record", () => {
  it("can still be deleted, seat and all", async () => {
    // The group points at a participant that points back at the group, and
    // deleting the group deletes that participant in the same statement. The
    // `set null` has to find the group already gone rather than trip over it.
    const { created, danaToken } = await startedByDana();
    const dana = await createTestUser();
    await claimGuestSession(dana.userId, danaToken);

    await deleteAccount(dana.userId);

    await expect(
      getDb().select().from(groups).where(eq(groups.id, created.id)),
    ).resolves.toHaveLength(0);
    await expect(
      getDb()
        .select()
        .from(participants)
        .where(eq(participants.groupId, created.id)),
    ).resolves.toHaveLength(0);
  });
});

describe("the migration that records the creator's seat", () => {
  /**
   * The backfill, run as written. The database this suite runs against has
   * already applied it — to no rows — so it is run again here over groups
   * made to look like ones started before the column existed.
   */
  async function runBackfill(): Promise<void> {
    const file = readFileSync(
      path.join(process.cwd(), "drizzle", "0038_guest_creator_seat.sql"),
      "utf8",
    );
    const backfill = file.split("--> statement-breakpoint").at(-1)!;
    await getPool().query(backfill);
  }

  it("finds the creator's seat of a guest-started group from its history", async () => {
    const { created } = await startedByDana();
    // Somebody else arrives first in every sense the old rule could see.
    await guestThroughTheLink(created.id, "Eli");
    await getDb()
      .update(groups)
      .set({ createdByParticipantId: null })
      .where(eq(groups.id, created.id));

    await runBackfill();

    const [group] = await getDb()
      .select({ seat: groups.createdByParticipantId })
      .from(groups)
      .where(eq(groups.id, created.id));
    expect(group?.seat).toBe(created.participantId);
  });

  it("leaves a group an account created alone", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    await runBackfill();

    const [row] = await getDb()
      .select({ seat: groups.createdByParticipantId })
      .from(groups)
      .where(eq(groups.id, group.groupId));
    expect(row?.seat).toBeNull();
  });
});
