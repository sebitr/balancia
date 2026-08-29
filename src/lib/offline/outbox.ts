import type { ExpenseInput } from "@/modules/expenses/schemas";
import { OUTBOX_STORE, idbDelete, idbGetAll, idbPut, randomKey } from "./idb";
import type { BlockReason } from "./replay";

/**
 * Entries typed with no server to send them to.
 *
 * The queue is per device, not per group: one list, drained in the order it
 * was filled, so an evening's expenses reach the server in the order they
 * happened rather than in whichever order the groups were opened.
 *
 * What is stored is the request body the server already accepts —
 * `expenseInputSchema`, minor-unit strings and all — and not some parallel
 * offline shape. An entry that came out of this queue is indistinguishable
 * from one typed with five bars of signal, because it is literally the same
 * payload; there is no second code path for the domain to drift along.
 */

/** The status an entry is in, from the reader's point of view. */
export type QueuedStatus =
  /** Waiting for a network. This is where nearly everything sits. */
  | "queued"
  /** Refused for a reason retrying will not fix; the reader has to look. */
  | "blocked";

export interface QueuedEntry {
  /**
   * The idempotency key, which is also this record's primary key.
   *
   * One value doing both jobs is deliberate: it makes it structurally
   * impossible for the queue to hold two records that would write the same
   * expense, and impossible for a replay to be sent under a key other than the
   * one its record is filed under.
   */
  readonly clientKey: string;
  readonly groupId: string;
  /** Carried so the pending list can name the group with no network. */
  readonly groupName: string;
  readonly payload: ExpenseInput;
  /** When the person pressed the button, not when it was sent. */
  readonly queuedAt: number;
  readonly attempts: number;
  readonly lastAttemptAt: number | null;
  readonly status: QueuedStatus;
  readonly blockedFor: BlockReason | null;
}

/**
 * Queue changes are broadcast rather than polled.
 *
 * Two listeners exist — the pending count in the group header and the sheet
 * that lists what is waiting — and both must move the moment an entry is
 * queued or sent. A store event would only tell other tabs; this tells this
 * one, which is where the reader is looking.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeToOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

/**
 * Puts an entry in the queue and hands back what was stored.
 *
 * The key is fixed before the first attempt to send and never changes
 * afterwards. That ordering is the whole guarantee: every attempt to write
 * this expense — the one happening now, the one after the tunnel, the one from
 * a tab that woke up tomorrow — carries the same key, so the server can
 * recognise them as one expense however many arrive.
 *
 * The caller may supply it, and the form does. It mints the key before
 * choosing between the server and the queue, so an entry that tried the
 * network first and fell back to here replays under the key that attempt used
 * — which is what makes a lost answer safe rather than a second expense.
 */
export async function enqueueEntry(input: {
  groupId: string;
  groupName: string;
  payload: ExpenseInput;
  clientKey?: string;
  now?: number;
}): Promise<QueuedEntry> {
  const entry: QueuedEntry = {
    clientKey: input.clientKey ?? randomKey(),
    groupId: input.groupId,
    groupName: input.groupName,
    payload: input.payload,
    queuedAt: input.now ?? Date.now(),
    attempts: 0,
    lastAttemptAt: null,
    status: "queued",
    blockedFor: null,
  };
  await idbPut(OUTBOX_STORE, entry);
  announce();
  return entry;
}

/** Everything waiting, oldest first. */
export async function listQueued(): Promise<QueuedEntry[]> {
  const entries = await idbGetAll<QueuedEntry>(OUTBOX_STORE);
  return entries.sort((a, b) => a.queuedAt - b.queuedAt);
}

/** What waits for a group, oldest first — the group's own pending rows. */
export async function listQueuedForGroup(
  groupId: string,
): Promise<QueuedEntry[]> {
  return (await listQueued()).filter((entry) => entry.groupId === groupId);
}

export async function countQueued(): Promise<number> {
  return (await listQueued()).length;
}

/** Drops an entry: it reached the server, or the reader threw it away. */
export async function removeQueued(clientKey: string): Promise<void> {
  await idbDelete(OUTBOX_STORE, clientKey);
  announce();
}

/**
 * Records an attempt that did not land.
 *
 * Writes the attempt back whether it is going to be retried or not, so the
 * count and the timestamp the backoff reads stay true, and so a blocked entry
 * keeps the reason it was blocked for.
 */
export async function recordAttempt(
  entry: QueuedEntry,
  update: {
    status: QueuedStatus;
    blockedFor: BlockReason | null;
    now?: number;
  },
): Promise<void> {
  const next: QueuedEntry = {
    ...entry,
    attempts: entry.attempts + 1,
    lastAttemptAt: update.now ?? Date.now(),
    status: update.status,
    blockedFor: update.blockedFor,
  };
  await idbPut(OUTBOX_STORE, next);
  announce();
}
