import { foldText } from "@/modules/categorization";

/**
 * Who a dictated sentence named, when it named anybody.
 *
 * `heardEntry` reads the money and stops there, and its own doc says why the
 * payer was left out: a misheard *name* is the correction people most often
 * have to make, and guessing at one spends the trust the rest of the feature
 * buys.
 *
 * That reasoning is about a guess that **disposes**. It is not about an
 * offer. "Anna paid the 120 taxi, split with me and Jonas" holds a payer, two
 * people and the split between them, and throwing four facts away because a
 * fifth might be wrong is the worse trade — the form is a confirm step
 * already, and a chip beside the split row is one tap to take and one tap to
 * refuse. So this reads the people out and hands them back as a proposal.
 * Nothing here touches the form; the form decides what to offer.
 *
 * The trust is bought back by refusing rather than by guessing, which is
 * three rules:
 *
 *  - **A name is only a name if this group has one.** Nothing is matched
 *    against the *shape* of a name — only against the roster. A sentence
 *    naming somebody who is not in the group proposes nobody, and the words
 *    stay in the description exactly as they were said.
 *  - **A name that could be two people is not a name.** Two members called
 *    Anna make "Anna" ambiguous, and an ambiguous name is dropped rather
 *    than settled by whoever joined first.
 *  - **A list is all of it or none of it.** "split with me and Jonas" in a
 *    group with no Jonas proposes *nothing* — never "just me". A list that
 *    quietly loses a member is how somebody ends up paying for two, and it
 *    is the one failure here that would be invisible on screen.
 *
 * What it never does is edit the sentence. It returns the character ranges
 * the clauses occupied and `heardEntry` is handed them, so that "Anna paid"
 * and "split with me and Jonas" do not end up in the description. A clause
 * whose names did not resolve occupies nothing, so its words survive — the
 * same graceful failure this parser has everywhere else.
 */

export interface HeardPerson {
  readonly id: string;
  readonly displayName: string;
}

/** Half-open character range of the trimmed sentence that a clause filled. */
export type HeardSpan = readonly [start: number, end: number];

export interface HeardPeople {
  /** The member the sentence said paid, or "" when it named none. */
  readonly payerId: string;
  /** Everybody the sentence put in the split, or [] when it named none. */
  readonly participantIds: readonly string[];
  /** What the clauses took up, for `heardEntry` to keep out of the words. */
  readonly spans: readonly HeardSpan[];
}

const NOBODY: HeardPeople = { payerId: "", participantIds: [], spans: [] };

/**
 * The verb that says somebody put the money in.
 *
 * Folded, so "payé" and "payée" arrive here without their accents. "regle" is
 * here because "Anna a réglé l'addition" is how a French speaker says it when
 * the word "payer" feels blunt, and it is the same fact.
 */
const PAID = new Set([
  "paid",
  "pays",
  "paye",
  "payee",
  "payes",
  "paya",
  "regle",
  "reglee",
  "regla",
]);

/** French puts an auxiliary between the two: "Anna **a** payé". */
const AUXILIARIES = new Set(["a", "has", "have", "ont", "avait"]);

/** "paid by Anna", "payé par Anna" — the same clause the other way round. */
const BY = new Set(["by", "par"]);

/**
 * The word that opens a split, and whether the speaker is inside it.
 *
 * "with" and "avec" leave the speaker in — "split it with Anna" is two
 * people, and nobody says "split it with Anna and me". "between" and "entre"
 * are exhaustive: "split between Anna and Jonas" is a bill the speaker is
 * paying no part of, and quietly adding them to it would change the money.
 */
const WITH = new Set(["with", "avec"]);
const BETWEEN = new Set(["between", "among", "amongst", "entre", "parmi"]);

/**
 * The verb in front of the marker, which is part of the clause and not part
 * of the description: "split with", "partagé avec", "divisé entre".
 */
const SPLIT_WORDS = new Set([
  "split",
  "splitting",
  "share",
  "shared",
  "divided",
  "partage",
  "partagee",
  "partager",
  "divise",
  "divisee",
  "diviser",
]);

/** What can sit between the verb and the marker: "split **it** with Anna". */
const FILLERS = new Set(["it", "this", "that", "ca", "cela"]);

/** What joins two names in a list. */
const JOINERS = new Set(["and", "et", "plus", "avec"]);

/**
 * The speaker, said the way people say themselves.
 *
 * "i" is deliberately not here. It opens far too many sentences that are
 * about something else — `heardEntry` already strips it as narration — and
 * "split with Jonas and I" is not how anybody speaks.
 */
const SELF = new Set(["me", "myself", "moi", "moimeme"]);

/**
 * "Just me", which is the other half of what this file's absence used to cost.
 *
 * A qualifier in front — "just me", "juste moi", "que moi" — or behind —
 * "moi seul", "me only". Both are exhaustive: the speaker, and nobody else.
 */
const ONLY_BEFORE = new Set([
  "just",
  "only",
  "juste",
  "seulement",
  "uniquement",
  "que",
  "rien",
]);
const ONLY_AFTER = new Set([
  "only",
  "alone",
  "seul",
  "seule",
  "seulement",
  "uniquement",
]);

/** A word reduced to the letters and digits a rule can match against. */
function fold(word: string): string {
  return foldText(word).replace(/[^a-z0-9]/g, "");
}

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** A name the roster answers to, as the folded words it is said in. */
interface Name {
  readonly words: readonly string[];
  readonly id: string;
}

/**
 * Every way a member of this group can be named, longest first.
 *
 * Two ways each: the whole display name, and — for a name in several words —
 * the first of them on its own, because "Anna" is what somebody says out loud
 * about Anna Meier. A key two members answer to is dropped rather than given
 * to either: an ambiguous name resolved by roster order is a wrong name that
 * looks like a right one.
 *
 * Longest first so that a group holding both "Anna" and "Anna Meier" reads
 * "Anna Meier paid" as Anna Meier — the two-word key wins where both fit, and
 * the bare "anna" key is ambiguous between them anyway.
 */
function namesOf(members: readonly HeardPerson[]): Name[] {
  const byKey = new Map<
    string,
    { id: string; words: string[]; several: boolean }
  >();

  const add = (words: string[], id: string): void => {
    if (words.length === 0) return;
    const key = words.join(" ");
    const seen = byKey.get(key);
    if (seen === undefined) byKey.set(key, { id, words, several: false });
    else if (seen.id !== id) seen.several = true;
  };

  for (const member of members) {
    const words = member.displayName
      .split(/\s+/)
      .map(fold)
      .filter((word) => word !== "");
    add(words, member.id);
    if (words.length > 1) add([words[0]!], member.id);
  }

  return [...byKey.values()]
    .filter((entry) => !entry.several)
    .map(({ words, id }) => ({ words, id }))
    .sort((a, b) => b.words.length - a.words.length);
}

/** The person named at this word, and how many words they took. */
function nameAt(
  words: readonly string[],
  at: number,
  names: readonly Name[],
  selfId: string,
): Name | null {
  const word = words[at];
  if (word === undefined) return null;
  if (selfId !== "" && SELF.has(word)) return { words: [word], id: selfId };
  return (
    names.find((name) => name.words.every((part, k) => words[at + k] === part)) ??
    null
  );
}

/** Whether a name at this position is being joined onto one before it. */
function joinedFrom(
  words: readonly string[],
  tokens: readonly Token[],
  at: number,
): boolean {
  if (at === 0) return false;
  return JOINERS.has(words[at - 1] ?? "") || /[,;]$/.test(tokens[at - 1]!.text);
}

/**
 * A run of names — "me and Jonas", "Anna, Jonas et moi".
 *
 * Null the moment a separator is followed by something that is not a name,
 * which is the rule that matters most in this file. Reading "split with me
 * and Jonas" as "just me" because the group has no Jonas would halve a bill
 * without saying so, and the reader would have no way to see it: the split
 * row would simply show one name, which is a thing they might have meant.
 */
function listAt(
  words: readonly string[],
  tokens: readonly Token[],
  from: number,
  names: readonly Name[],
  selfId: string,
): { ids: string[]; last: number } | null {
  const ids: string[] = [];
  let at = from;

  for (;;) {
    const name = nameAt(words, at, names, selfId);
    if (name === null) return null;
    ids.push(name.id);

    const last = at + name.words.length - 1;
    at = last + 1;

    if (JOINERS.has(words[at] ?? "")) {
      at += 1;
      continue;
    }
    // A comma rides on the word before it, so the separator is punctuation
    // rather than a token of its own: "Anna, Jonas et moi".
    if (/[,;]$/.test(tokens[last]!.text)) continue;
    return { ids, last };
  }
}

/** The clause that says who paid, or null when the sentence has none. */
function payerClause(
  words: readonly string[],
  tokens: readonly Token[],
  names: readonly Name[],
  selfId: string,
): { id: string; span: HeardSpan } | null {
  for (let at = 0; at < tokens.length; at += 1) {
    // "paid by Anna". A name joined onto another one — "paid by Anna and
    // Jonas" — is two payers, which is a sheet rather than a chip, so it
    // proposes none.
    if (PAID.has(words[at] ?? "") && BY.has(words[at + 1] ?? "")) {
      const name = nameAt(words, at + 2, names, selfId);
      const after = name === null ? -1 : at + 2 + name.words.length;
      if (name !== null && !JOINERS.has(words[after] ?? "")) {
        return {
          id: name.id,
          span: [tokens[at]!.start, tokens[after - 1]!.end],
        };
      }
      continue;
    }

    // "Anna paid", "Anna a payé". Never the second half of a list: "Anna et
    // Jonas ont payé" names two, and taking Jonas alone would be a quiet
    // half-truth.
    if (joinedFrom(words, tokens, at)) continue;
    const name = nameAt(words, at, names, selfId);
    if (name === null) continue;
    let verb = at + name.words.length;
    if (AUXILIARIES.has(words[verb] ?? "")) verb += 1;
    if (!PAID.has(words[verb] ?? "")) continue;
    return { id: name.id, span: [tokens[at]!.start, tokens[verb]!.end] };
  }
  return null;
}

/** The clause that says who shares it, or null when the sentence has none. */
function splitClause(
  words: readonly string[],
  tokens: readonly Token[],
  names: readonly Name[],
  selfId: string,
  taken: HeardSpan | null,
): { ids: string[]; span: HeardSpan } | null {
  const free = (at: number): boolean =>
    taken === null || tokens[at]!.end <= taken[0] || tokens[at]!.start >= taken[1];

  for (let at = 0; at < tokens.length; at += 1) {
    if (!free(at)) continue;
    const word = words[at] ?? "";

    // "just me" and "moi seul": the speaker, and nobody else.
    if (selfId !== "") {
      if (ONLY_BEFORE.has(word) && SELF.has(words[at + 1] ?? "")) {
        return {
          ids: [selfId],
          span: [tokens[at]!.start, tokens[at + 1]!.end],
        };
      }
      if (SELF.has(word) && ONLY_AFTER.has(words[at + 1] ?? "")) {
        return {
          ids: [selfId],
          span: [tokens[at]!.start, tokens[at + 1]!.end],
        };
      }
    }

    const inclusive = WITH.has(word);
    if (!inclusive && !BETWEEN.has(word)) continue;

    const list = listAt(words, tokens, at + 1, names, selfId);
    if (list === null) continue;

    /*
     * The verb in front belongs to the clause: "split with Anna" leaves
     * nothing behind, while "dinner shared with Anna" leaves the dinner. One
     * filler is allowed between the two, because "split it with Anna" is how
     * it is said as often as not.
     */
    let head = at;
    if (SPLIT_WORDS.has(words[at - 1] ?? "") && free(at - 1)) head = at - 1;
    else if (
      FILLERS.has(words[at - 1] ?? "") &&
      SPLIT_WORDS.has(words[at - 2] ?? "") &&
      free(at - 2)
    ) {
      head = at - 2;
    }

    const ids = inclusive ? [selfId, ...list.ids] : list.ids;
    return {
      ids: ids.filter((id) => id !== ""),
      span: [tokens[head]!.start, tokens[list.last]!.end],
    };
  }
  return null;
}

/** The named people in roster order, each of them once. */
function ordered(
  ids: readonly string[],
  members: readonly HeardPerson[],
): string[] {
  const named = new Set(ids);
  const known = members
    .filter((member) => named.has(member.id))
    .map((member) => member.id);
  const rest = [...named].filter((id) => !known.includes(id));
  return [...known, ...rest];
}

export function heardPeople(
  spoken: string,
  members: readonly HeardPerson[],
  selfId = "",
): HeardPeople {
  const text = spoken.trim();
  if (text === "") return NOBODY;

  const tokens: Token[] = [...text.matchAll(/\S+/g)].map((match) => ({
    text: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const words = tokens.map((token) => fold(token.text));
  const names = namesOf(members);

  const payer = payerClause(words, tokens, names, selfId);
  const split = splitClause(words, tokens, names, selfId, payer?.span ?? null);

  const spans: HeardSpan[] = [];
  if (payer) spans.push(payer.span);
  if (split) spans.push(split.span);

  return {
    payerId: payer?.id ?? "",
    participantIds: split ? ordered(split.ids, members) : [],
    spans,
  };
}
