import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import { groupMembers, participants } from "@/lib/db/schema";
import {
  createJoinLink,
  resolveJoinLink,
  revokeJoinLink,
  InvalidJoinLinkError,
} from "@/lib/security/join-link";
import {
  claimMember,
  createMember,
  listClaimableMembers,
  loadJoinSummary,
} from "@/modules/join/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../../../tests/helpers/factories";

/**
 * The join flow against a real PostgreSQL.
 *
 * Two things here cannot be checked any other way. The claim guard is a
 * conditional UPDATE whose whole purpose is to be decided by the database when
 * two transactions race, and the link's "one live link per group" rule is a
 * partial unique index — a mock would happily let both through.
 */

describe("join links", () => {
  it("resolves a fresh link to its group", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor, { name: "Lisbon, March" });

    const link = await createJoinLink(group.groupId, {
      createdByUserId: actor.userId,
    });
    const resolved = await resolveJoinLink(link.token);

    expect(resolved.groupId).toBe(group.groupId);
    expect(resolved.groupName).toBe("Lisbon, March");
    expect(resolved.inviterName).toBe("Amélie");
  });

  it("rejects a revoked link", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const link = await createJoinLink(group.groupId);

    await revokeJoinLink(group.groupId);

    await expect(resolveJoinLink(link.token)).rejects.toThrow(
      InvalidJoinLinkError,
    );
  });

  it("rejects an expired link", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const link = await createJoinLink(group.groupId, {
      expiresAt: new Date(Date.now() - 1000),
    });

    await expect(resolveJoinLink(link.token)).rejects.toMatchObject({
      reason: "expired",
    });
  });

  it("retires the previous link when a new one is minted", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    const first = await createJoinLink(group.groupId);
    const second = await createJoinLink(group.groupId);

    // The partial unique index only permits one live row, so replacing has to
    // revoke inside the same transaction or this insert would have failed.
    await expect(resolveJoinLink(first.token)).rejects.toMatchObject({
      reason: "revoked",
    });
    await expect(resolveJoinLink(second.token)).resolves.toMatchObject({
      groupId: group.groupId,
    });
  });

  it("rejects a token that was never issued", async () => {
    await expect(resolveJoinLink("A".repeat(43))).rejects.toThrow(
      InvalidJoinLinkError,
    );
  });
});

describe("listClaimableMembers", () => {
  it("lists only people without an account", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor, { name: "Lisbon" });
    await addTestParticipant(group.groupId, "Jonas Thévenot");
    await addTestParticipant(group.groupId, "Marta Ruiz");

    const claimable = await listClaimableMembers(group.groupId);

    // Amélie owns the group, so her row is linked and must not be offered.
    expect(claimable.map((member) => member.displayName)).toEqual([
      "Jonas Thévenot",
      "Marta Ruiz",
    ]);
  });

  it("excludes a removed participant", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);
    const jonas = await addTestParticipant(group.groupId, "Jonas");
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, jonas));

    const claimable = await listClaimableMembers(group.groupId);

    expect(claimable).toHaveLength(0);
  });

  it("reports an empty group with no claimable names", async () => {
    const actor = await createTestUser();
    const group = await createTestGroup(actor);

    expect(await listClaimableMembers(group.groupId)).toEqual([]);
  });
});

describe("loadJoinSummary", () => {
  it("counts the people in the group", async () => {
    const actor = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(actor, { name: "Lisbon" });
    await addTestParticipant(group.groupId, "Jonas");
    await addTestParticipant(group.groupId, "Marta");

    const summary = await loadJoinSummary(group.groupId);

    expect(summary.groupName).toBe("Lisbon");
    expect(summary.participantCount).toBe(3);
    expect(summary.expenseCount).toBe(0);
    expect(summary.faces).toHaveLength(3);
  });
});

describe("claimMember", () => {
  it("links the participant and grants membership", async () => {
    const owner = await createTestUser({ name: "Amélie" });
    const group = await createTestGroup(owner);
    const jonasId = await addTestParticipant(group.groupId, "Jonas");
    const joiner = await createTestUser({ name: "Jonas" });

    const outcome = await claimMember({
      groupId: group.groupId,
      participantId: jonasId,
      userId: joiner.userId,
    });

    expect(outcome).toEqual({ status: "joined", participantId: jonasId });

    const [row] = await getDb()
      .select({ userId: participants.userId })
      .from(participants)
      .where(eq(participants.id, jonasId));
    expect(row.userId).toBe(joiner.userId);

    const membership = await getDb()
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(eq(groupMembers.participantId, jonasId));
    expect(membership).toHaveLength(1);
  });

  it("refuses a participant that already has an account", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const jonasId = await addTestParticipant(group.groupId, "Jonas");
    const first = await createTestUser();
    const second = await createTestUser();

    await claimMember({
      groupId: group.groupId,
      participantId: jonasId,
      userId: first.userId,
    });
    const outcome = await claimMember({
      groupId: group.groupId,
      participantId: jonasId,
      userId: second.userId,
    });

    expect(outcome.status).toBe("taken");
  });

  it("lets only one of two concurrent claims win", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const jonasId = await addTestParticipant(group.groupId, "Jonas");
    const one = await createTestUser();
    const two = await createTestUser();

    // The whole point of putting `userId IS NULL` in the UPDATE predicate:
    // both transactions are in flight before either has committed.
    const [first, second] = await Promise.all([
      claimMember({
        groupId: group.groupId,
        participantId: jonasId,
        userId: one.userId,
      }),
      claimMember({
        groupId: group.groupId,
        participantId: jonasId,
        userId: two.userId,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["joined", "taken"]);

    const membership = await getDb()
      .select({ id: groupMembers.id })
      .from(groupMembers)
      .where(eq(groupMembers.participantId, jonasId));
    expect(membership).toHaveLength(1);
  });

  it("reports an account that is already in the group", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const jonasId = await addTestParticipant(group.groupId, "Jonas");

    const outcome = await claimMember({
      groupId: group.groupId,
      participantId: jonasId,
      userId: owner.userId,
    });

    expect(outcome).toEqual({
      status: "already-member",
      participantId: group.ownerParticipantId,
    });
  });

  it("refuses a removed participant", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const jonasId = await addTestParticipant(group.groupId, "Jonas");
    await getDb()
      .update(participants)
      .set({ removedAt: new Date() })
      .where(eq(participants.id, jonasId));
    const joiner = await createTestUser();

    const outcome = await claimMember({
      groupId: group.groupId,
      participantId: jonasId,
      userId: joiner.userId,
    });

    expect(outcome.status).toBe("taken");
  });
});

describe("createMember", () => {
  it("adds a new participant linked to the account", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const joiner = await createTestUser();

    const outcome = await createMember({
      groupId: group.groupId,
      userId: joiner.userId,
      displayName: "  Wilhelmina  ",
    });

    expect(outcome.status).toBe("joined");
    if (outcome.status !== "joined") return;

    const [row] = await getDb()
      .select({
        displayName: participants.displayName,
        userId: participants.userId,
      })
      .from(participants)
      .where(eq(participants.id, outcome.participantId));

    expect(row.displayName).toBe("Wilhelmina");
    expect(row.userId).toBe(joiner.userId);
  });

  it("refuses to add an account that is already in the group", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);

    const outcome = await createMember({
      groupId: group.groupId,
      userId: owner.userId,
      displayName: "Amélie again",
    });

    expect(outcome).toEqual({
      status: "already-member",
      participantId: group.ownerParticipantId,
    });
  });
});
