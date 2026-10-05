/**
 * Who put something on this device, and who is using it now.
 *
 * The device's stores outlive a session. A queued entry waits for a network,
 * not for the person who typed it, and before this file existed the flush sent
 * whatever it found with whatever session cookie was present — so if one
 * member of a group signed out and another signed in on the same phone, the
 * first one's evening was posted as the second's. Every queued entry and every
 * draft now carries its author, and nothing is sent or offered back to anybody
 * else.
 *
 * Signing out also empties these stores (see `forget.ts`); this is what holds
 * when a session ends some other way — it expires, or it is revoked from
 * another device — and the next person signs in over what was left behind.
 */

/**
 * Who typed a queued entry or a draft.
 *
 * An account is known by its user id, which is the same person in every group.
 * A guest has no account, only a seat — one participant row in the one group
 * their link opened — so a guest is known by that seat and that group.
 *
 * The seat shape also serves for a record written before authors were kept:
 * it is adopted by the seat the device's snapshot of its group named, which
 * the same form wrote (see `ownerFor` and `adoptUnowned` in `idb.ts`).
 */
export type EntryOwner =
  | { readonly kind: "user"; readonly userId: string }
  | {
      readonly kind: "participant";
      readonly groupId: string;
      readonly participantId: string;
    };

/**
 * Who is using the app right now, as the screen on show knows it.
 *
 * Handed down from the group layout, which has already resolved the actor to
 * authorize the page, so knowing it costs no request of its own. On the
 * offline screen, where no server rendered anything, it comes from the group's
 * snapshot instead — see `snapshotActor`.
 */
export interface DeviceActor {
  /** The account signed in, or null for a guest. */
  readonly userId: string | null;
  /** The group on screen. */
  readonly groupId: string;
  /** The actor's own row in that group: a guest's seat, or an account's. */
  readonly participantId: string | null;
}

/** The stamp a record written by this actor carries. */
export function ownerFor(actor: DeviceActor): EntryOwner | null {
  if (actor.userId) return { kind: "user", userId: actor.userId };
  if (actor.participantId) {
    return {
      kind: "participant",
      groupId: actor.groupId,
      participantId: actor.participantId,
    };
  }
  return null;
}

/**
 * Whether something on the device is this actor's to see and to send.
 *
 * An account's record is that account's in any group. A seat is whoever holds
 * it now: the guest whose link it was, and the account that guest became —
 * signing up claims the seat by linking the same participant row to the new
 * account (`claimGuestSession`), so an evening typed as a guest still goes
 * once its author has an account. A seat can only be recognised from inside
 * its own group, which for a guest is the only place there is.
 *
 * A record with no owner at all belongs to nobody. The upgrade that introduced
 * owners adopted every older one it could; one it could not is held until the
 * next sign-out clears it, which is the safe way for that to fail — the
 * alternative is sending it as whoever happens to be here.
 */
export function belongsTo(
  owner: EntryOwner | null | undefined,
  actor: DeviceActor,
): boolean {
  if (!owner) return false;
  if (owner.kind === "user") return owner.userId === actor.userId;
  return (
    owner.groupId === actor.groupId &&
    owner.participantId === actor.participantId
  );
}

/**
 * The actor a group snapshot was taken for.
 *
 * A snapshot written before owners were kept has no `userId`, and reads as
 * its seat — `selfId`, the reader's own row, which the form it was taken from
 * defaults the payer to. That is the rule for every record from before this
 * change, and the upgrade in `idb.ts` applies it through here too.
 */
export function snapshotActor(snapshot: {
  readonly groupId: string;
  readonly selfId: string;
  readonly userId?: string | null;
}): DeviceActor {
  return {
    userId: snapshot.userId ?? null,
    groupId: snapshot.groupId,
    participantId: snapshot.selfId,
  };
}
