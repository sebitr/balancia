import { DRAFT_STORE, idbDelete, idbGet, idbPut } from "./idb";

/**
 * The entry somebody started and did not finish.
 *
 * This is the interrupted-at-the-till case, which is where most missing
 * entries come from: the amount is typed, something happens, the drawer is
 * closed, and the expense is never recorded at all. Closing it with something
 * in it now keeps that something.
 *
 * Four decisions, and each of them is a thing the feature does *not* do:
 *
 *  - **No "you have unsaved changes" dialog.** The draft *is* the answer to
 *    that question; asking as well is asking twice, and the second ask lands
 *    at exactly the moment somebody is trying to leave.
 *  - **Local to the device and never synced.** A half-typed amount visible to
 *    flatmates is worse than losing it. It stays in this browser, in this
 *    profile, and no server ever hears about it.
 *  - **One per group.** A list of abandoned drafts is a second inbox. The
 *    newest replaces whatever was there.
 *  - **Expires silently after a week.** A draft is a continuation of
 *    something a person was doing, and after seven days they were not doing
 *    it. Nothing announces the expiry, because nothing announced the draft.
 *
 * Every function answers rather than throws — `idb.ts` explains why — so a
 * device that refuses IndexedDB simply never has a draft, which is the
 * behaviour that existed before this file.
 */

/** Seven days, in milliseconds. */
export const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface EntryDraft {
  readonly groupId: string;
  /** When it was set aside. Used only to expire it. */
  readonly savedAt: number;
  /**
   * The form's own fields, as it hands them over.
   *
   * Deliberately opaque here: what a draft *is* belongs to the drawer, and a
   * shape spelled out in two places is a shape that drifts. The drawer
   * validates what it reads back, since a draft can outlive the version of
   * the form that wrote it.
   */
  readonly fields: unknown;
  /** What the group screen shows on the dashed row, already formatted. */
  readonly summary: {
    readonly amount: string;
    readonly description: string;
  };
}

/** Whether a draft is still worth offering back. */
export function isFresh(draft: EntryDraft, now: number): boolean {
  const age = now - draft.savedAt;
  // A negative age is a clock that moved backwards, not a draft from the
  // future: treat it as fresh rather than throwing away real work.
  return age < DRAFT_TTL_MS;
}

export async function saveDraft(draft: EntryDraft): Promise<void> {
  await idbPut(DRAFT_STORE, draft);
}

/**
 * The group's draft, if it has a fresh one.
 *
 * An expired draft is deleted on the way past rather than left to accumulate:
 * this is the only moment anything looks at it, so it is the only moment the
 * sweep can happen.
 */
export async function loadDraft(
  groupId: string,
  now: number = Date.now(),
): Promise<EntryDraft | null> {
  const draft = await idbGet<EntryDraft>(DRAFT_STORE, groupId);
  if (!draft) return null;
  if (!isFresh(draft, now)) {
    await discardDraft(groupId);
    return null;
  }
  return draft;
}

export async function discardDraft(groupId: string): Promise<void> {
  await idbDelete(DRAFT_STORE, groupId);
}
