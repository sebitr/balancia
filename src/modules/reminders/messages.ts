/**
 * The message library: twenty ways to ask, none of them accusing.
 *
 * The copy rule the whole feature rests on is that the *debt* asks, never the
 * person who tapped Remind. No draft says who sent it, none invents a deadline,
 * and none appeals to guilt — so a reminder can be forwarded, screenshotted or
 * read months later without embarrassing anybody.
 *
 * Only the keys live here. The sentences themselves are in the message
 * catalogues, because a reminder has to arrive in the *recipient's* language,
 * not the sender's, and a draft frozen as English text could not do that.
 */

export type RemindTone = "gentle" | "dry" | "cheeky";

export interface Draft {
  /** Key under `remind.drafts` in the catalogue. */
  readonly key: string;
  readonly tone: RemindTone;
}

/**
 * Order matters: the caption counts a draft's position in this list ("Draft 4
 * of 20"), so inserting one in the middle renumbers the rest.
 */
export const DRAFTS: readonly Draft[] = [
  { key: "gentle1", tone: "gentle" },
  { key: "gentle2", tone: "gentle" },
  { key: "gentle3", tone: "gentle" },
  { key: "gentle4", tone: "gentle" },
  { key: "gentle5", tone: "gentle" },
  { key: "gentle6", tone: "gentle" },
  { key: "gentle7", tone: "gentle" },
  { key: "dry1", tone: "dry" },
  { key: "dry2", tone: "dry" },
  { key: "dry3", tone: "dry" },
  { key: "dry4", tone: "dry" },
  { key: "dry5", tone: "dry" },
  { key: "dry6", tone: "dry" },
  { key: "dry7", tone: "dry" },
  { key: "cheeky1", tone: "cheeky" },
  { key: "cheeky2", tone: "cheeky" },
  { key: "cheeky3", tone: "cheeky" },
  { key: "cheeky4", tone: "cheeky" },
  { key: "cheeky5", tone: "cheeky" },
  { key: "cheeky6", tone: "cheeky" },
];

/** Gentle is what an unconfigured group sends. Cheeky is opted into. */
export const DEFAULT_TONE: RemindTone = "gentle";

export function draftsOf(tone: RemindTone): Draft[] {
  return DRAFTS.filter((draft) => draft.tone === tone);
}

/** Where a draft sits in the library, 1-based, for the "Draft 4 of 20" line. */
export function positionOf(key: string): number {
  return DRAFTS.findIndex((draft) => draft.key === key) + 1;
}

/**
 * Picks a draft in the given tone, never handing back the one already on
 * screen.
 *
 * Shuffling to the same sentence reads as a broken button, so the current
 * draft is removed from the pool rather than filtered out afterwards — which
 * would sometimes silently do nothing. A tone with a single draft is the one
 * case where repeating is unavoidable, and it repeats rather than failing.
 */
export function pickDraft(
  tone: RemindTone,
  current: string | null,
  random: () => number = Math.random,
): Draft {
  const pool = draftsOf(tone);
  const choices =
    pool.length > 1 ? pool.filter((draft) => draft.key !== current) : pool;
  const index = Math.min(
    Math.floor(random() * choices.length),
    choices.length - 1,
  );
  return choices[index];
}
