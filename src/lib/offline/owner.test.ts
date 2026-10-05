import { describe, expect, it } from "vitest";
import { belongsTo, ownerFor, snapshotActor, type DeviceActor } from "./owner";

/**
 * Who a record on the device belongs to.
 *
 * The flush and the drawer both ask this one function, so the rules are
 * pinned here once: an account anywhere, a seat inside its own group, and
 * nobody for a record nobody could place.
 */

const LISBON = "22222222-2222-4222-8222-222222222222";
const FLAT = "33333333-3333-4333-8333-333333333333";

const ADA: DeviceActor = {
  userId: "aaaaaaaa-0000-4000-8000-000000000001",
  groupId: LISBON,
  participantId: "aaaaaaaa-0000-4000-8000-00000000000a",
};

const GUEST: DeviceActor = {
  userId: null,
  groupId: LISBON,
  participantId: "cccccccc-0000-4000-8000-00000000000c",
};

describe("ownerFor", () => {
  it("stamps an account with the account", () => {
    expect(ownerFor(ADA)).toEqual({ kind: "user", userId: ADA.userId });
  });

  it("stamps a guest with their seat and its group", () => {
    expect(ownerFor(GUEST)).toEqual({
      kind: "participant",
      groupId: LISBON,
      participantId: GUEST.participantId,
    });
  });

  it("stamps nobody when nobody is known", () => {
    expect(
      ownerFor({ userId: null, groupId: LISBON, participantId: null }),
    ).toBeNull();
  });
});

describe("belongsTo", () => {
  it("matches an account in any group", () => {
    const owner = ownerFor(ADA);
    expect(belongsTo(owner, { ...ADA, groupId: FLAT })).toBe(true);
    expect(belongsTo(owner, { ...ADA, userId: "somebody else" })).toBe(false);
  });

  it("does not take a guest for an account, or an account for a guest", () => {
    expect(belongsTo(ownerFor(ADA), GUEST)).toBe(false);
    expect(belongsTo(ownerFor(GUEST), ADA)).toBe(false);
  });

  it("matches a seat only in its own group", () => {
    const owner = ownerFor(GUEST);
    expect(belongsTo(owner, GUEST)).toBe(true);
    expect(belongsTo(owner, { ...GUEST, groupId: FLAT })).toBe(false);
  });

  it("matches nothing without an owner", () => {
    expect(belongsTo(null, ADA)).toBe(false);
    expect(belongsTo(undefined, ADA)).toBe(false);
  });
});

describe("snapshotActor", () => {
  it("reads an account's snapshot as that account", () => {
    const actor = snapshotActor({
      groupId: LISBON,
      selfId: ADA.participantId!,
      userId: ADA.userId,
    });
    expect(ownerFor(actor)).toEqual({ kind: "user", userId: ADA.userId });
  });

  it("reads a snapshot from before owners were kept as its seat", () => {
    // No `userId` on the copy at all. `selfId` is the reader's own row — the
    // form's default payer — and it is the only record of who they were.
    const actor = snapshotActor({
      groupId: LISBON,
      selfId: ADA.participantId!,
    });
    expect(ownerFor(actor)).toEqual({
      kind: "participant",
      groupId: LISBON,
      participantId: ADA.participantId,
    });
    // Which the account that holds that seat still matches, in that group.
    expect(belongsTo(ownerFor(actor), ADA)).toBe(true);
  });
});
