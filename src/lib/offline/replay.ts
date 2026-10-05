/**
 * What to do with a queued entry once the server has answered — or failed to.
 *
 * Split out from the flush that calls it because this is the part with the
 * judgement in it, and the part that must not be got wrong: every branch here
 * is somebody's money either landing, waiting, or being held back for them to
 * look at. None of it touches IndexedDB or `fetch`, so all of it is tested.
 *
 * The one rule the whole module serves: a queued entry is never dropped except
 * on a written answer or on an explicit discard by the person who typed it. A
 * server that is down, a session that expired, a phone that is still in a
 * tunnel — all of those are waiting, not failing.
 */

/** Why an entry has stopped being retried, in terms the interface can say. */
export type BlockReason =
  /** The group is gone, or this reader is no longer in it. */
  | "noAccess"
  /** The group is still there, archived, and takes nothing new until restored. */
  | "archived"
  /** The server understood and refused — a removed payer, an invalid split. */
  | "refused";

export type ReplayVerdict =
  /** The server has it. Drop it from the queue. */
  | { readonly kind: "written" }
  /** Not this time. Leave it queued and come back. */
  | { readonly kind: "retry" }
  /** It will never be accepted as it stands; show it to the reader. */
  | { readonly kind: "blocked"; readonly reason: BlockReason };

const WRITTEN: ReplayVerdict = { kind: "written" };
const RETRY: ReplayVerdict = { kind: "retry" };

/**
 * A status code, and the `code` a refusal carries, read as one of three fates.
 *
 * 201 is what a write answers, whether it created the expense or found the
 * idempotency key already spent and handed back what it made last time. Both
 * mean the server has the entry exactly once, which is the only thing the
 * queue needs to know.
 *
 * 200 is accepted beside it because "already done" is conventionally that, and
 * this queue must not be the reason an entry is sent a third time if a future
 * version of the route — or something in front of it — says so.
 *
 * 401 is a *retry*, not a failure, and the distinction is the reason this
 * function exists. A session that expired while the phone was in a tunnel is
 * the single most likely thing to greet a reconnecting flush, and treating it
 * as a refusal would discard an evening's expenses at the moment the reader
 * signs back in and expects to find them.
 *
 * 404 covers both "no such group" and "you are not in it" — the mobile API
 * answers the same way to each on purpose, so that group ids are not
 * probeable. 403 is read the same way, and this queue does not meet one: the
 * group's `noPermission` is an owner-only action asked for by somebody else,
 * and adding an expense is every role's to do; an API key's refusal needs a
 * key, and this queue sends the session cookie.
 *
 * 422 is the entry refused as it stands. Above all that is a payer, or
 * somebody in the split, who was removed from the group while this device was
 * offline — the one genuinely awkward case: the entry names somebody the group
 * no longer has, and only a person can decide what it should say instead. It
 * used to arrive as a 404, and the entry's author was told they had lost the
 * group.
 *
 * 409 is the group's own state refusing it. On this route that is a group
 * archived while the entry waited, which its reader can still open and read,
 * so it is told apart by its code rather than called gone. A 409 without that
 * code is a refusal like any other.
 */
export function classifyStatus(status: number, code?: string): ReplayVerdict {
  if (status === 200 || status === 201) return WRITTEN;
  if (status === 401 || status === 429) return RETRY;
  if (status === 403 || status === 404) {
    return { kind: "blocked", reason: "noAccess" };
  }
  if (status === 409) {
    return {
      kind: "blocked",
      reason: code === "groupArchived" ? "archived" : "refused",
    };
  }
  if (status === 422) return { kind: "blocked", reason: "refused" };
  // 5xx, and anything unforeseen. An entry is never dropped on a status this
  // module does not recognise — the server is the thing that changed, not the
  // expense.
  return RETRY;
}

/**
 * How long to wait before trying an entry again, by how many attempts it has
 * already survived: roughly 5s, 15s, 45s, then a two-minute ceiling.
 *
 * There is a backoff at all because a flush is provoked by events — coming
 * online, returning to the tab — and a phone at the edge of a cell hands out a
 * great many of those. Without it, an instance that is down would be asked
 * again on every flicker.
 *
 * The ceiling is low because the alternative to waiting is not a spared server
 * but a reader looking at an expense that says it has not been sent yet.
 */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(5_000 * 3 ** (attempts - 1), 120_000);
}

/** Whether enough time has passed since the last attempt to make another. */
export function isDue(
  entry: { readonly attempts: number; readonly lastAttemptAt: number | null },
  now: number,
): boolean {
  if (entry.lastAttemptAt === null) return true;
  return now - entry.lastAttemptAt >= backoffMs(entry.attempts);
}
