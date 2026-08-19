/**
 * Finding the joiner among the names already in the group.
 *
 * The person typing has no idea what spelling somebody else used for them
 * three weeks ago. "jonas" has to reach "Jonas Thévenot", "thevenot" has to
 * reach it back, and "Jo" — which could be anyone — must reach nothing at all,
 * because a wrong suggestion here is not a cosmetic slip: accepting it hands
 * one person's expense history to another.
 *
 * So the ranking is deliberately conservative. A suggestion is offered only
 * when one candidate scores above a floor *and* is clearly ahead of the
 * runner-up; on a tie, nobody is suggested and the reader picks from the full
 * list, which is the safe outcome rather than a degraded one.
 *
 * Pure and synchronous: no database, no locale, so it is cheap to test and the
 * scoring can be argued about without a fixture.
 */

/** Enough overlap to be worth showing. Tuned by the cases in the tests. */
const SUGGESTION_FLOOR = 0.62;

/** How far ahead of the runner-up the winner must be to be shown alone. */
const AMBIGUITY_MARGIN = 0.12;

/** Below this, a token is too short to carry a fuzzy match. */
const FUZZY_MIN_LENGTH = 4;

export interface MatchCandidate {
  readonly id: string;
  readonly name: string;
}

export interface MatchResult<T extends MatchCandidate> {
  readonly candidate: T;
  readonly score: number;
}

/**
 * Casefold, strip accents, drop punctuation.
 *
 * `NFD` splits "é" into "e" plus a combining acute, which the range below then
 * removes — so "Thévenot" and "Thevenot" become the same string. Apostrophes
 * and hyphens go too: "O'Neill", "ONeill" and "o neill" are one name typed
 * three ways.
 */
export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokensOf(value: string): readonly string[] {
  const normalized = normalizeName(value);
  return normalized.length === 0 ? [] : normalized.split(" ");
}

/**
 * Levenshtein distance, two rows rather than a full matrix.
 *
 * Names are short, so this is nowhere near hot enough to want anything
 * cleverer; the row pair is just to avoid allocating n×m for no reason.
 */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);
  let current = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1);
      current[j] = Math.min(substitution, previous[j] + 1, current[j - 1] + 1);
    }
    [previous, current] = [current, previous];
  }
  return previous[b.length];
}

/** 1 for identical, 0 for nothing in common. */
function tokenSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  // A typed token that opens a stored one — "seb" against "sebastien" — is a
  // deliberate shortening far more often than it is a coincidence.
  if (a.length >= 3 && b.startsWith(a)) return 0.94;
  if (b.length >= 3 && a.startsWith(b)) return 0.94;

  // Fuzzy only once there is enough word to misspell. Without this floor,
  // three-letter tokens sit one edit from half the alphabet.
  if (a.length < FUZZY_MIN_LENGTH || b.length < FUZZY_MIN_LENGTH) return 0;

  const distance = editDistance(a, b);
  const longest = Math.max(a.length, b.length);
  const similarity = 1 - distance / longest;
  // Two edits on a short name is not a typo, it is a different name.
  return distance <= 2 && similarity >= 0.7 ? similarity : 0;
}

/**
 * How well a typed name matches a stored one.
 *
 * Every typed token takes its best partner in the stored name, and the score
 * is their mean — so "jonas" against "Jonas Thévenot" scores 1, not 0.5. What
 * the reader typed is the question; the surname they omitted is not a miss.
 *
 * The reverse is not true. Typing "Jonas Thévenot" against a stored "Jonas"
 * leaves the surname with no partner and halves the score, which is what makes
 * the full name pick the full row when both are in the list.
 */
export function scoreName(typed: string, candidate: string): number {
  const typedTokens = tokensOf(typed);
  const candidateTokens = tokensOf(candidate);
  if (typedTokens.length === 0 || candidateTokens.length === 0) return 0;

  let total = 0;
  for (const token of typedTokens) {
    let best = 0;
    for (const other of candidateTokens) {
      best = Math.max(best, tokenSimilarity(token, other));
      if (best === 1) break;
    }
    total += best;
  }

  return total / typedTokens.length;
}

/**
 * The one name to offer, or null.
 *
 * Null covers three different situations on purpose — nothing typed yet,
 * nothing close enough, and two names equally close — because the screen does
 * the same thing in all three: show the whole list and let the reader choose.
 */
export function suggestMatch<T extends MatchCandidate>(
  typed: string,
  candidates: readonly T[],
): MatchResult<T> | null {
  const normalized = normalizeName(typed);
  if (normalized.length < 2) return null;

  // Typing a name exactly settles it, even against a near-twin that the margin
  // below would otherwise call ambiguous. Only when it is unique: two rows
  // spelled identically are the one case the reader must resolve themselves.
  const exact = candidates.filter(
    (candidate) => normalizeName(candidate.name) === normalized,
  );
  if (exact.length === 1) return { candidate: exact[0], score: 1 };
  if (exact.length > 1) return null;

  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: scoreName(typed, candidate.name),
    }))
    .filter((entry) => entry.score >= SUGGESTION_FLOOR)
    .sort((a, b) => b.score - a.score);

  const [best, runnerUp] = ranked;
  if (!best) return null;
  if (runnerUp && best.score - runnerUp.score < AMBIGUITY_MARGIN) return null;
  return best;
}
