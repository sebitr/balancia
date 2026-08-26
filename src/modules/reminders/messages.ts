/**
 * The message library: seventy ways to ask, none of them accusing.
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
 * Order matters, because the key carries the number: slotting a draft into the
 * middle of a tone shifts every key after it onto a different sentence, and
 * Weblate holds each translation against the key rather than the text — so the
 * German for `gentle15` would quietly end up under the English of `gentle16`.
 * New drafts are therefore appended to the end of their tone rather than
 * placed where they read best.
 *
 * A tone is worth having only if it has enough sentences that the reroll never
 * comes back around to one the sender just dismissed. Every draft below obeys
 * the same grammar as well as the same manners: `{amount}` is never the subject
 * of a verb, because it is a phrase — "€148.00", or "€148.00 and ¥1,400" — and
 * a sentence built to agree with a plural breaks on the single-currency case
 * (and, in French, on the participle too).
 */
export const DRAFTS: readonly Draft[] = [
  { key: "gentle1", tone: "gentle" },
  { key: "gentle2", tone: "gentle" },
  { key: "gentle3", tone: "gentle" },
  { key: "gentle4", tone: "gentle" },
  { key: "gentle5", tone: "gentle" },
  { key: "gentle6", tone: "gentle" },
  { key: "gentle7", tone: "gentle" },
  { key: "gentle8", tone: "gentle" },
  { key: "gentle9", tone: "gentle" },
  { key: "gentle10", tone: "gentle" },
  { key: "gentle11", tone: "gentle" },
  { key: "gentle12", tone: "gentle" },
  { key: "gentle13", tone: "gentle" },
  { key: "gentle14", tone: "gentle" },
  { key: "gentle15", tone: "gentle" },
  { key: "gentle16", tone: "gentle" },
  { key: "gentle17", tone: "gentle" },
  { key: "gentle18", tone: "gentle" },
  { key: "gentle19", tone: "gentle" },
  { key: "gentle20", tone: "gentle" },
  { key: "gentle21", tone: "gentle" },
  { key: "gentle22", tone: "gentle" },
  { key: "gentle23", tone: "gentle" },
  { key: "gentle24", tone: "gentle" },
  { key: "dry1", tone: "dry" },
  { key: "dry2", tone: "dry" },
  { key: "dry3", tone: "dry" },
  { key: "dry4", tone: "dry" },
  { key: "dry5", tone: "dry" },
  { key: "dry6", tone: "dry" },
  { key: "dry7", tone: "dry" },
  { key: "dry8", tone: "dry" },
  { key: "dry9", tone: "dry" },
  { key: "dry10", tone: "dry" },
  { key: "dry11", tone: "dry" },
  { key: "dry12", tone: "dry" },
  { key: "dry13", tone: "dry" },
  { key: "dry14", tone: "dry" },
  { key: "dry15", tone: "dry" },
  { key: "dry16", tone: "dry" },
  { key: "dry17", tone: "dry" },
  { key: "dry18", tone: "dry" },
  { key: "dry19", tone: "dry" },
  { key: "dry20", tone: "dry" },
  { key: "dry21", tone: "dry" },
  { key: "dry22", tone: "dry" },
  { key: "dry23", tone: "dry" },
  { key: "dry24", tone: "dry" },
  { key: "cheeky1", tone: "cheeky" },
  { key: "cheeky2", tone: "cheeky" },
  { key: "cheeky3", tone: "cheeky" },
  { key: "cheeky4", tone: "cheeky" },
  { key: "cheeky5", tone: "cheeky" },
  { key: "cheeky6", tone: "cheeky" },
  { key: "cheeky7", tone: "cheeky" },
  { key: "cheeky8", tone: "cheeky" },
  { key: "cheeky9", tone: "cheeky" },
  { key: "cheeky10", tone: "cheeky" },
  { key: "cheeky11", tone: "cheeky" },
  { key: "cheeky12", tone: "cheeky" },
  { key: "cheeky13", tone: "cheeky" },
  { key: "cheeky14", tone: "cheeky" },
  { key: "cheeky15", tone: "cheeky" },
  { key: "cheeky16", tone: "cheeky" },
  { key: "cheeky17", tone: "cheeky" },
  { key: "cheeky18", tone: "cheeky" },
  { key: "cheeky19", tone: "cheeky" },
  { key: "cheeky20", tone: "cheeky" },
  { key: "cheeky21", tone: "cheeky" },
  { key: "cheeky22", tone: "cheeky" },
];

/** Gentle is what an unconfigured group sends. Cheeky is opted into. */
export const DEFAULT_TONE: RemindTone = "gentle";

export function draftsOf(tone: RemindTone): Draft[] {
  return DRAFTS.filter((draft) => draft.tone === tone);
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
