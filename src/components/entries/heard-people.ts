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
 *
 * The vocabulary below was written against a sweep of seventy-odd realistic
 * transcripts in both languages rather than from the inside, which is how
 * every list in `heard-entry.ts` was got wrong the first time. What that
 * sweep is worth is in `heard-people.test.ts`, as the table.
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
 * The verbs that say somebody put the money in.
 *
 * Wider than "pay", because almost nobody says "pay" out loud. They say Anna
 * *got* the coffees, Jonas *covered* the taxi, Hervé *avancé* the deposit,
 * Anna *a offert* the round — every one of those is the same fact, and the
 * sweep found the parser deaf to all of them. Folded, so "payé", "payée" and
 * "réglé" arrive without their accents.
 *
 * The list can afford to be wide because it is never the evidence on its own:
 * a payer clause needs a name the roster answered to sitting right in front
 * of the verb. "Anna got the flu" is not a sentence anybody dictates into an
 * expense form, and if they did, the chip is one tap to refuse.
 */
const PAID = new Set([
  "paid",
  "pays",
  "paying",
  "paye",
  "payee",
  "payes",
  "payant",
  "paya",
  "regle",
  "reglee",
  "regla",
  "offert",
  "offerte",
  "offre",
  "spent",
  "spend",
  "spends",
  "depense",
  "depensee",
  "depenses",
  "bought",
  "buy",
  "buys",
  "achete",
  "achetee",
  "achetes",
  "covered",
  "cover",
  "covers",
  "got",
  "gets",
  "avance",
  "avancee",
]);

/**
 * What is allowed to sit between a name and its verb.
 *
 * French rarely puts them together — "Anna **a** payé", "Jonas **a tout**
 * payé", "c'est Anna **qui a** payé", "Anna **nous a** payé le taxi" — and
 * English is no better once it reaches for a tense: "Hervé **is** paying".
 * Three of these at most, and none of them is a conjunction, so a second name
 * always ends the run rather than being stepped over.
 */
const LINKERS = new Set([
  "a",
  "as",
  "ai",
  "ont",
  "avons",
  "avez",
  "avait",
  "avaient",
  "has",
  "have",
  "had",
  "is",
  "are",
  "was",
  "were",
  "been",
  "qui",
  "who",
  "that",
  "est",
  "sont",
  "nous",
  "me",
  "lui",
  "leur",
  "tout",
  "tous",
  "all",
  "deja",
  "already",
  "en",
  "y",
  // "Anna et moi **on a** partagé le taxi" — French reaches for a second
  // subject pronoun where English would simply say "we".
  "on",
  "we",
  "they",
  "il",
  "elle",
  "ils",
  "elles",
  "se",
  "s",
]);

/** "paid by Anna", "payé par Anna" — the same clause the other way round. */
const BY = new Set(["by", "par"]);

/**
 * "**C'est** Anna qui a payé" — the cleft the clause is usually wrapped in.
 *
 * Part of the clause rather than part of the description: left behind it puts
 * a bare "c'est" at the head of the field.
 */
const CLEFTS = new Set(["cest", "cetait", "its", "itwas"]);

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
 * And "for", which is both and neither.
 *
 * "gift for Marie" is a present; "coffee for me and Anna" is a split. What
 * separates them is the speaker: somebody buying a gift does not put
 * themselves in it. So "for" opens a split only where the list it opens holds
 * the speaker *and* somebody else — which is also what lets "Anna a payé pour
 * tout le monde" mean the whole group.
 */
const FOR = new Set(["for", "pour"]);

/**
 * The verb that says a thing was shared, wherever it sits.
 *
 * Usually next to the marker — "split with", "partagé avec" — but French puts
 * the object in between as a matter of course: "on a partagé le taxi avec
 * Anna". So it is looked for anywhere ahead of the marker and claimed on its
 * own, which is what turns that sentence's description from "partagé le taxi"
 * into "taxi".
 */
const SPLIT_WORDS = new Set([
  "split",
  "splits",
  "splitting",
  "share",
  "shares",
  "shared",
  "sharing",
  "divide",
  "divided",
  "partage",
  "partagee",
  "partages",
  "partagees",
  "partager",
  "partagent",
  "partageons",
  "partagez",
  "divise",
  "divisee",
  "divises",
  "divisees",
  "diviser",
]);

/**
 * What may sit between the split verb and the marker, and is scaffolding too.
 *
 * Grammar and arithmetic only — "split **it 50/50** with Anna", "split
 * **equally** between us" — never a noun. "Split the bill with Anna" keeps
 * its bill: the article goes with the verb, and what is left is the one word
 * in the sentence that says what the money was for.
 */
const FILLERS = new Set([
  "it",
  "this",
  "that",
  "ca",
  "cela",
  "equally",
  "evenly",
  "equitablement",
  "half",
  "moitie",
  "moitiemoitie",
  "way",
  "ways",
  "two",
  "three",
  "four",
  "deux",
  "trois",
  "quatre",
]);

/** And what may sit in front of it: "**on a** partagé", "**was** split". */
const SPLIT_LINKERS = new Set([
  "on",
  "we",
  "a",
  "ont",
  "avons",
  "avez",
  "nous",
  "se",
  "s",
  "est",
  "sont",
  "was",
  "were",
  "is",
  "are",
  "been",
  "have",
  "has",
]);

/** What joins two names in a list. */
const JOINERS = new Set(["and", "et", "plus", "avec"]);

/**
 * The speaker, said the way people say themselves.
 *
 * "i" is here for "Anna and I split the taxi", which is how English says it
 * and which the first cut of this file heard as nothing at all. It is safe
 * because it is never evidence on its own: a bare "I" opens a narration
 * `heardEntry` already strips, and every shape below needs a verb or a marker
 * beside it before it will believe a word is a person.
 */
const SELF = new Set(["me", "myself", "moi", "moimeme", "i", "je"]);

/**
 * Everybody, which people say far more often than they list the group.
 *
 * Only ever read where a name would be — after a marker, or in front of a
 * split verb — so "tous" keeps every other meaning it has.
 */
const EVERYONE: readonly (readonly string[])[] = [
  ["tout", "le", "monde"],
  ["all", "of", "us"],
  ["nous", "tous"],
  ["nous", "toutes"],
  ["us", "all"],
  ["everyone"],
  ["everybody"],
  ["tous"],
  ["toutes"],
];

/**
 * "Just me", which is the other half of what this file's absence used to cost.
 *
 * A qualifier in front — "just me", "juste moi", "rien que moi" — or behind —
 * "moi tout seul", "me only". Both are exhaustive: the speaker, and nobody
 * else.
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

/**
 * Whether this word was written as a name rather than as grammar.
 *
 * The same signal `heardEntry` uses on a description, for the same reason: a
 * recogniser capitalises what it takes for a proper noun. Here it decides
 * whether the word after a comma is a person the roster failed to place — in
 * which case the list is abandoned — or simply the rest of the sentence.
 */
function writtenAsName(word: string): boolean {
  const first = word[0] ?? "";
  return /[a-zA-Z]/.test(first) && first !== first.toLowerCase();
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

/** Everything a reading needs to know about who is in this group. */
interface Roster {
  readonly names: readonly Name[];
  readonly members: readonly HeardPerson[];
  readonly selfId: string;
}

/** The person named at this word, and how many words they took. */
function nameAt(
  words: readonly string[],
  at: number,
  roster: Roster,
): Name | null {
  const word = words[at];
  if (word === undefined) return null;
  if (roster.selfId !== "" && SELF.has(word)) {
    return { words: [word], id: roster.selfId };
  }
  return (
    roster.names.find((name) =>
      name.words.every((part, k) => words[at + k] === part),
    ) ?? null
  );
}

/** Whichever way "everybody" was said here, and how many words it took. */
function everyoneAt(words: readonly string[], at: number): number {
  for (const phrase of EVERYONE) {
    if (phrase.every((part, k) => words[at + k] === part)) return phrase.length;
  }
  return 0;
}

/** One entry in a list of people: somebody, or all of them. */
function elementAt(
  words: readonly string[],
  at: number,
  roster: Roster,
): { ids: string[]; length: number } | null {
  const all = everyoneAt(words, at);
  if (all > 0) {
    return { ids: roster.members.map((member) => member.id), length: all };
  }
  const name = nameAt(words, at, roster);
  return name === null ? null : { ids: [name.id], length: name.words.length };
}

/** Whether a name ends on this word, so that a list could run through it. */
function endsAName(
  words: readonly string[],
  at: number,
  roster: Roster,
): boolean {
  if (everyoneAt(words, at) === 1) return true;
  for (let from = Math.max(0, at - 2); from <= at; from += 1) {
    const element = elementAt(words, from, roster);
    if (element !== null && from + element.length - 1 === at) return true;
  }
  return false;
}

/**
 * Whether a name at this position is being joined onto one before it.
 *
 * The point is to stop "Anna et Jonas ont payé" proposing Jonas alone. What
 * it must not do is stop "dinner 80 francs, Anna paid" proposing Anna, which
 * is what a bare comma test did: a comma is punctuation far more often than
 * it is enumeration, so what is checked is whether a *name* ends where the
 * list would have to have started.
 */
function joinedFrom(
  words: readonly string[],
  tokens: readonly Token[],
  at: number,
  roster: Roster,
): boolean {
  let before = at - 1;
  if (before < 0) return false;
  const joiner = JOINERS.has(words[before] ?? "");
  if (!joiner && !/[,;]$/.test(tokens[before]!.text)) return false;
  if (joiner) before -= 1;
  return before >= 0 && endsAName(words, before, roster);
}

/**
 * A run of names — "me and Jonas", "Anna, Jonas et moi", "tout le monde".
 *
 * Null the moment an explicit joiner is followed by something that is not a
 * name, which is the rule that matters most in this file. Reading "split with
 * me and Jonas" as "just me" because the group has no Jonas would halve a
 * bill without saying so, and the reader would have no way to see it: the
 * split row would simply show one name, which is a thing they might have
 * meant.
 *
 * A comma is weaker evidence than an "and", and holding it to the same
 * standard cost the sweep four sentences: "split the bill with Anna and
 * Jonas, 90 francs" ends its list at the comma and goes on with the money. So
 * a comma closes the list — unless what follows it was *written as a name*,
 * which is a person the roster could not place, and the list is abandoned
 * again.
 */
function listAt(
  words: readonly string[],
  tokens: readonly Token[],
  from: number,
  roster: Roster,
): { ids: string[]; last: number } | null {
  const ids: string[] = [];
  let at = from;

  for (;;) {
    const element = elementAt(words, at, roster);
    if (element === null) return null;
    ids.push(...element.ids);

    const last = at + element.length - 1;
    at = last + 1;

    if (JOINERS.has(words[at] ?? "")) {
      at += 1;
      continue;
    }
    // A comma rides on the word before it, so the separator is punctuation
    // rather than a token of its own: "Anna, Jonas et moi".
    if (/[,;]$/.test(tokens[last]!.text)) {
      if (elementAt(words, at, roster) !== null) continue;
      const next = tokens[at];
      if (next !== undefined && writtenAsName(next.text)) return null;
    }
    return { ids, last };
  }
}

/** The clause that says who paid, or null when the sentence has none. */
function payerClause(
  words: readonly string[],
  tokens: readonly Token[],
  roster: Roster,
): { id: string; span: HeardSpan } | null {
  for (let at = 0; at < tokens.length; at += 1) {
    // "paid by Anna". A name joined onto another one — "paid by Anna and
    // Jonas" — is two payers, which is a sheet rather than a chip, so it
    // proposes none.
    if (PAID.has(words[at] ?? "") && BY.has(words[at + 1] ?? "")) {
      const name = nameAt(words, at + 2, roster);
      const after = name === null ? -1 : at + 2 + name.words.length;
      if (name !== null && !JOINERS.has(words[after] ?? "")) {
        return {
          id: name.id,
          span: [tokens[at]!.start, tokens[after - 1]!.end],
        };
      }
      continue;
    }

    // "Anna paid", "Anna a payé", "c'est Anna qui a payé". Never the second
    // half of a list: "Anna et Jonas ont payé" names two, and taking Jonas
    // alone would be a quiet half-truth.
    if (joinedFrom(words, tokens, at, roster)) continue;
    const name = nameAt(words, at, roster);
    if (name === null) continue;

    let verb = at + name.words.length;
    for (let step = 0; step < 3 && LINKERS.has(words[verb] ?? ""); step += 1) {
      verb += 1;
    }
    if (!PAID.has(words[verb] ?? "")) continue;

    const head = CLEFTS.has(words[at - 1] ?? "") ? at - 1 : at;
    // "Anna covered **it**" — the verb's own object is part of the clause,
    // never part of what the money was for.
    const tail = FILLERS.has(words[verb + 1] ?? "") ? verb + 1 : verb;
    return { id: name.id, span: [tokens[head]!.start, tokens[tail]!.end] };
  }
  return null;
}

/**
 * The span the split verb fills, wherever it sits ahead of the marker.
 *
 * Its own range rather than an extension of the clause's, because French puts
 * the object between the two — "on a partagé le taxi avec Anna" — and the
 * taxi in the middle is the one word that has to survive. Anything purely
 * grammatical between the verb and the marker goes with it, so "split it
 * 50/50 with Anna" leaves nothing and "split the bill with Anna" leaves the
 * bill.
 */
function verbSpan(
  words: readonly string[],
  tokens: readonly Token[],
  marker: number,
  free: (at: number) => boolean,
): HeardSpan | null {
  let verb = -1;
  for (let at = marker - 1; at >= 0; at -= 1) {
    if (!free(at)) break;
    if (SPLIT_WORDS.has(words[at] ?? "")) {
      verb = at;
      break;
    }
  }
  if (verb === -1) return null;

  let head = verb;
  for (
    let step = 0;
    step < 2 &&
    head > 0 &&
    free(head - 1) &&
    SPLIT_LINKERS.has(words[head - 1] ?? "");
    step += 1
  ) {
    head -= 1;
  }

  let tail = verb;
  while (tail + 1 < marker && FILLERS.has(words[tail + 1] ?? "")) tail += 1;
  while (tail + 1 < marker && /^[\d/.,-]+$/.test(words[tail + 1] ?? "x")) {
    tail += 1;
  }

  return [tokens[head]!.start, tokens[tail]!.end];
}

interface SplitClause {
  readonly ids: readonly string[];
  readonly spans: readonly HeardSpan[];
}

/** The clause that says who shares it, or null when the sentence has none. */
function splitClause(
  words: readonly string[],
  tokens: readonly Token[],
  roster: Roster,
  taken: HeardSpan | null,
): SplitClause | null {
  const free = (at: number): boolean =>
    taken === null ||
    tokens[at]!.end <= taken[0] ||
    tokens[at]!.start >= taken[1];

  for (let at = 0; at < tokens.length; at += 1) {
    if (!free(at)) continue;
    const word = words[at] ?? "";

    // "just me", "rien que moi", "moi tout seul": the speaker, and nobody
    // else. Two qualifiers in front, and one "tout" allowed behind.
    if (roster.selfId !== "") {
      let opener = at;
      while (opener < at + 2 && ONLY_BEFORE.has(words[opener] ?? "")) {
        opener += 1;
      }
      if (opener > at && SELF.has(words[opener] ?? "")) {
        return {
          ids: [roster.selfId],
          spans: [[tokens[at]!.start, tokens[opener]!.end]],
        };
      }
      if (SELF.has(word)) {
        let closer = at + 1;
        if (words[closer] === "tout" || words[closer] === "all") closer += 1;
        if (ONLY_AFTER.has(words[closer] ?? "")) {
          return {
            ids: [roster.selfId],
            spans: [[tokens[at]!.start, tokens[closer]!.end]],
          };
        }
      }
    }

    const inclusive = WITH.has(word) || FOR.has(word);
    if (!inclusive && !BETWEEN.has(word)) continue;

    const list = listAt(words, tokens, at + 1, roster);
    if (list === null) continue;
    /*
     * "for" is the one marker that has to earn it. A gift for Marie is not a
     * split with Marie — what tells the two apart is the speaker being in the
     * list, and being in it alongside somebody else.
     */
    if (
      FOR.has(word) &&
      !(list.ids.includes(roster.selfId) && list.ids.length > 1)
    ) {
      continue;
    }

    const named = inclusive ? [roster.selfId, ...list.ids] : list.ids;
    const ids = named.filter((id) => id !== "");
    // "Split between everyone" in a group of nobody is a clause that resolved
    // to no one, and cutting its words out would be a loss for nothing.
    if (ids.length === 0) continue;

    const clause: HeardSpan = [tokens[at]!.start, tokens[list.last]!.end];
    const verb = verbSpan(words, tokens, at, free);
    return { ids, spans: verb === null ? [clause] : [verb, clause] };
  }
  return null;
}

/**
 * "Anna and I split the taxi" — the people first and the verb after them.
 *
 * English says it this way as often as it says "split with", and French says
 * "Anna et moi avons partagé le taxi". Read only where no marker clause was
 * found, and only for two people or more: "Anna split the bill" says who did
 * the dividing, not who it was divided between, and answering that with a
 * split of one would be an invention.
 *
 * "Anna and Jonas only" ends the same way round and needs no verb, so it is
 * read here too — and one name is enough for it, because "only" has already
 * said the list is the whole of it. It is the same shape as "just me", which
 * is why the two agree about "me only" whichever of them gets there first.
 */
function subjectClause(
  words: readonly string[],
  tokens: readonly Token[],
  roster: Roster,
  taken: HeardSpan | null,
): SplitClause | null {
  const free = (at: number): boolean =>
    taken === null ||
    tokens[at]!.end <= taken[0] ||
    tokens[at]!.start >= taken[1];

  for (let at = 0; at < tokens.length; at += 1) {
    if (!free(at)) continue;
    if (joinedFrom(words, tokens, at, roster)) continue;
    const list = listAt(words, tokens, at, roster);
    if (list === null || list.ids.length === 0) continue;

    // "…and Jonas only": the list is exhaustive because the word says so.
    let closer = list.last + 1;
    if (words[closer] === "tout" || words[closer] === "all") closer += 1;
    if (ONLY_AFTER.has(words[closer] ?? "")) {
      return {
        ids: list.ids,
        spans: [[tokens[at]!.start, tokens[closer]!.end]],
      };
    }

    if (list.ids.length < 2) continue;
    let verb = list.last + 1;
    for (let step = 0; step < 3 && LINKERS.has(words[verb] ?? ""); step += 1) {
      verb += 1;
    }
    if (!SPLIT_WORDS.has(words[verb] ?? "")) continue;

    let tail = verb;
    while (tail + 1 < tokens.length && FILLERS.has(words[tail + 1] ?? "")) {
      tail += 1;
    }
    return {
      ids: list.ids,
      spans: [[tokens[at]!.start, tokens[tail]!.end]],
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
  const roster: Roster = { names: namesOf(members), members, selfId };

  const payer = payerClause(words, tokens, roster);
  const paidSpan = payer?.span ?? null;
  const split =
    splitClause(words, tokens, roster, paidSpan) ??
    subjectClause(words, tokens, roster, paidSpan);

  const spans: HeardSpan[] = [];
  if (payer) spans.push(payer.span);
  if (split) spans.push(...split.spans);

  return {
    payerId: payer?.id ?? "",
    participantIds: split ? ordered(split.ids, members) : [],
    spans,
  };
}
