import type { ExpenseCategory } from "@/modules/categorization";
import { SNAPSHOT_STORE, idbGet, idbGetAll, idbPut } from "./idb";

/**
 * Enough of a group, kept on the device, for its entry form to open with no
 * network at all.
 *
 * Only what the form reads: who is in the group, what it files things under,
 * and which currency it counts in. Not its balances, not its history, not one
 * expense — this is the scope the feature was asked for, and it is also the
 * only scope that is honest. A cached balance is a number that was true when
 * the phone last had signal, and showing one beside a form that is adding to it
 * would be a lie with two digits after the point.
 *
 * Written every time the form opens with a server behind it, so the copy on the
 * device is whatever the group looked like the last time this reader saw it.
 * That is the right staleness to carry: somebody who joined the group this
 * morning is in it, and somebody who joins tonight, while the trip is in a
 * valley, is not — and cannot be, by any means available offline.
 */
export interface GroupSnapshot {
  readonly groupId: string;
  readonly groupName: string;
  readonly members: readonly { id: string; displayName: string }[];
  /** The reader's own participant row — the default payer. */
  readonly selfId: string;
  readonly currencyMode: "separate" | "converted";
  readonly baseCurrency: string | null;
  readonly defaultCurrency: string;
  readonly timezone: string;
  /** What this group files things under, most used first. */
  readonly frequentCategories: readonly ExpenseCategory[];
  /** When this copy was taken, so the form can say how old it is. */
  readonly capturedAt: number;
}

export async function saveSnapshot(
  snapshot: Omit<GroupSnapshot, "capturedAt"> & { capturedAt?: number },
): Promise<void> {
  await idbPut(SNAPSHOT_STORE, {
    ...snapshot,
    capturedAt: snapshot.capturedAt ?? Date.now(),
  });
}

export function loadSnapshot(groupId: string): Promise<GroupSnapshot | null> {
  return idbGet<GroupSnapshot>(SNAPSHOT_STORE, groupId);
}

/**
 * Every group this device could open a form for, most recently seen first.
 *
 * This is what the offline screen offers. A group that is on the list is one
 * the reader has actually visited on this device, which is a good enough proxy
 * for "one they might add to tonight" and the only one available without asking
 * a server.
 */
export async function listSnapshots(): Promise<GroupSnapshot[]> {
  const snapshots = await idbGetAll<GroupSnapshot>(SNAPSHOT_STORE);
  return snapshots.sort((a, b) => b.capturedAt - a.capturedAt);
}

/**
 * Whether a payer named by a queued entry is still somebody the group knows.
 *
 * Used when the form reopens on a snapshot: a participant removed since the
 * snapshot was taken is not in it, and an entry built against a stale member
 * list would be refused on arrival with a message nobody can act on hours
 * later. Checking here means the refusal happens in front of the person, while
 * they still remember the dinner.
 */
export function knowsParticipant(
  snapshot: GroupSnapshot,
  participantId: string,
): boolean {
  return snapshot.members.some((member) => member.id === participantId);
}
