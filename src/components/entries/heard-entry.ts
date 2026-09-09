import { foldText } from "@/modules/categorization";
import { SUPPORTED_CURRENCY_CODES } from "@/modules/currencies/iso-4217";
import type { HeardSpan } from "./heard-people";

/**
 * What a spoken sentence turns into.
 *
 * "add 24 francs Coop to Flat 12" is one gesture instead of four fields, and
 * it is the path for the moment somebody is standing at a till with a bag in
 * one hand. The recogniser gives words; this turns words into an amount, a
 * currency and a description, and nothing else.
 *
 * Three rules, and they are all the same rule — *propose, never dispose*:
 *
 *  - **Nothing is auto-saved.** What is heard fills the form and the reader
 *    confirms it. A wrong expense that saved itself is worse than no expense,
 *    because it is wrong in the balances and nobody was watching.
 *  - **Anything not heard stays at its default.** A sentence with no currency
 *    in it does not mean "no currency", it means the group's.
 *  - **Failure is not an error screen.** When nothing parses, the raw words go
 *    in the description and the amount is left empty and focused. The reader
 *    is one field from done rather than back where they started.
 *
 * Deliberately not here: the people. A misheard *name* is the correction
 * people most often have to make, so nothing in this file resolves one — the
 * money and the words are all it reads. Who paid and who shares it are
 * `heard-people.ts`, which answers with a proposal the reader accepts or
 * refuses rather than with fields; what this file wants from it is only the
 * `skip` below, so that "Anna paid" and "split with me and Jonas" do not end
 * up in the description of a taxi.
 */

export interface HeardEntry {
  /** Major units as spoken, ready for the amount field. "" when none heard. */
  readonly amountText: string;
  /** An ISO code, or "" to leave the group's own currency alone. */
  readonly currency: string;
  /** What is left once the amount and the currency words are taken out. */
  readonly description: string;
}

/**
 * Currency words people actually say, to the code they mean.
 *
 * Spoken, not written: nobody says "CHF" out loud in a shop. The codes
 * themselves are matched too, since a recogniser sometimes writes them.
 *
 * And it writes the *abbreviation* rather than either — which is the whole
 * reason "restaurant 50 francs" came back with "fr." sitting in the
 * description. Ask a Swiss recogniser for francs and it gives you the way
 * Switzerland writes them on a till receipt: "50 fr.". The dot is folded away
 * before any of this is matched, and "fr" is two letters, so the ISO-code path
 * never saw it either.
 */
const SPOKEN_CURRENCIES: Readonly<Record<string, string>> = {
  franc: "CHF",
  francs: "CHF",
  balles: "CHF",
  fr: "CHF",
  frs: "CHF",
  sfr: "CHF",
  euro: "EUR",
  euros: "EUR",
  dollar: "USD",
  dollars: "USD",
  buck: "USD",
  bucks: "USD",
  pound: "GBP",
  pounds: "GBP",
  quid: "GBP",
  livre: "GBP",
  livres: "GBP",
};

/**
 * The signs a recogniser writes instead of the word.
 *
 * Dictating money is exactly where this happens: ask for "thirty euros" and
 * Chrome is as likely to write "30 €" as "30 euros", and in English it puts
 * the sign in front and closes it up — "$24". Reading only the words missed
 * every one of those and left the group's currency in place, which is the one
 * kind of wrong that changes a balance quietly.
 */
const SYMBOL_CURRENCIES: readonly (readonly [string, string])[] = [
  ["€", "EUR"],
  ["$", "USD"],
  ["£", "GBP"],
  ["¥", "JPY"],
  ["₣", "CHF"],
];

/**
 * Words that only ever introduce the entry, never describe it.
 *
 * Taken off the front of the *sentence* only, which is what keeps "note" a
 * verb in "note 12 francs" and a thing you buy in "12 francs note book".
 */
const LEADING_WORDS = new Set([
  "add",
  "ajoute",
  "ajouter",
  "note",
  "noter",
  "new",
  "nouvelle",
  "expense",
  "depense",
  "for",
  "pour",
  "of",
  "de",
  "d",
  "spent",
  "paid",
  "paye",
  // People narrate rather than command: "I paid…", "j'ai payé…", "on a
  // payé…", "ajoute une dépense de…". Every one of these left its own opening
  // words sitting in the description.
  "i",
  "we",
  "jai",
  "on",
  "a",
  "an",
  "une",
  "un",
  "log",
  "put",
  "the",
]);

/**
 * Words that only ever join the amount to what it was for.
 *
 * Dropped from the *front of the description*, and only once an amount has
 * been found: "30 euros for the train" is a train, while "coffee for the
 * office" parsed to nothing and is handed back exactly as it was said.
 */
const PREPOSITIONS = new Set([
  "for",
  "on",
  "at",
  "to",
  "of",
  "pour",
  "au",
  "aux",
  "chez",
  "de",
  "d",
  "en",
]);

/**
 * Articles, which go only in a preposition's wake.
 *
 * "for the train" loses both; "La Poste" loses neither. An article at the
 * head of a description is far more often the first word of a name than
 * scaffolding — French shopfronts are full of them, and so is every high
 * street — and dropping it on its own turned Le Gruyère into Gruyère.
 */
const ARTICLES = new Set([
  "the",
  "a",
  "an",
  "le",
  "la",
  "les",
  "du",
  "des",
  "un",
  "une",
]);

/**
 * Whether this word was written as a name rather than as grammar.
 *
 * A recogniser capitalises what it takes for a proper noun, and nothing else
 * mid-sentence — the amount has already been said by the time any of this is
 * read, so a capital here is not a sentence's opening one. It is the only
 * signal separating "12 euros au restaurant" from "12 euros Au Bon Pain", and
 * it costs nothing when the engine hands back a flat lowercase transcript:
 * the words are dropped, exactly as they were before.
 */
function looksLikeName(word: string): boolean {
  const first = word[0] ?? "";
  return first !== first.toLowerCase();
}

/**
 * The number in the sentence, however it was written down.
 *
 * Two shapes: a grouped one — "1 500", "1,500", "1'200", "2,499.99" — and a
 * plain run of digits. The apostrophe is there because this is a Swiss app
 * and Switzerland groups with one: a rent dictated as "1'200 francs" was
 * being read as two hundred. The grouped shape is tried first, because a plain run would
 * match "1" out of "1,500" and hand the form a rent of one franc. Both are
 * bounded by non-digits at either end, so a long run produces nothing at all:
 * 0041791234567 is a phone number, and finding "91234567" inside it would put
 * a figure in the field that nobody said.
 */
const AMOUNT =
  /(?<!\d)(?:\d{1,3}(?:[   .,'’]\d{3})+|\d{1,8})(?:[.,]\d{1,2})?(?!\d)/;

/** A run of two digits, which is how cents are said after the unit. */
const CENTS = /^\d{2}$/;

/**
 * And what they are sometimes called afterwards.
 *
 * "50 francs 20 centimes" left the word behind once the figure was taken, so
 * the description read "centimes". Only ever read directly after a two-digit
 * cents figure, which is what keeps the French "cent" a hundred everywhere
 * else.
 */
const CENT_WORDS = new Set([
  "centime",
  "centimes",
  "cent",
  "cents",
  "rappen",
  "rp",
  "ct",
  "cts",
]);

/** A word reduced to the letters and digits a rule can match against. */
function fold(word: string): string {
  return foldText(word).replace(/[^a-z0-9]/g, "");
}

/** The code a sign in this word stands for, or "" if it holds none. */
function symbolCurrency(word: string): string {
  for (const [symbol, code] of SYMBOL_CURRENCIES) {
    if (word.includes(symbol)) return code;
  }
  return "";
}

/**
 * A written number read as a figure, separators and all.
 *
 * The ambiguity is real and old: "1,500" is fifteen hundred to an English
 * speaker and "1.500" is the same number to a French one, while "12,50" is
 * twelve-fifty to both. What tells them apart is the length of the last
 * group — three digits after the final separator is a thousand, one or two is
 * a decimal — and that rule holds whichever way round the writer's locale
 * puts the two marks. Spaces and apostrophes only ever group.
 */
function readAmount(raw: string): { text: string; decimal: boolean } {
  const compact = raw.replace(/[   '’]/g, "");
  const lastSeparator = Math.max(
    compact.lastIndexOf("."),
    compact.lastIndexOf(","),
  );
  if (lastSeparator === -1) return { text: compact, decimal: false };

  const tail = compact.slice(lastSeparator + 1);
  if (tail.length === 3) {
    // Every mark in it groups thousands; none of them is a decimal point.
    return { text: compact.replace(/[.,]/g, ""), decimal: false };
  }
  const whole = compact.slice(0, lastSeparator).replace(/[.,]/g, "");
  return { text: `${whole}.${tail}`, decimal: true };
}

interface Token {
  readonly text: string;
  readonly start: number;
  readonly end: number;
}

/** Words with the offsets that say which of them the amount was written in. */
function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(/\S+/g)) {
    tokens.push({
      text: match[0],
      start: match.index,
      end: match.index + match[0].length,
    });
  }
  return tokens;
}

/** Every figure in the sentence, so that the right one can be picked. */
const AMOUNT_ALL = new RegExp(AMOUNT.source, "g");

/**
 * The code this word names — as a sign, as a spoken word, or as ISO.
 *
 * The written code is matched only where it was *written* as one, and the
 * capitals are the whole of that test. Three-letter words are cheap and the
 * ISO list is long: cup, pen, top, mad, bob, gel, sos, all and lak are every
 * one of them a currency somewhere — Cuban peso, Peruvian sol, Tongan
 * paʻanga, Moroccan dirham. Folding case before the lookup meant "coffee cup
 * 5 francs" came back as five Cuban pesos with "coffee francs" for a
 * description: the cup had taken the currency, so the francs never did, and
 * were left in the words instead.
 *
 * A recogniser writes a code in capitals and a person saying "cup" does not,
 * so capitals are what separates the two.
 */
function currencyOf(word: string): string {
  const symbol = symbolCurrency(word);
  if (symbol !== "") return symbol;
  const spoken = SPOKEN_CURRENCIES[fold(word)];
  if (spoken !== undefined) return spoken;
  const letters = word.replace(/[^A-Za-z]/g, "");
  return letters.length === 3 &&
    letters === letters.toUpperCase() &&
    SUPPORTED_CURRENCY_CODES.includes(letters)
    ? letters
    : "";
}

/**
 * Which figure in the sentence is the money.
 *
 * The first one is not the answer, and believing it was is what turned "2
 * coffees 8 francs" into an expense of two francs with "coffees 8" written
 * beside it. People count things out loud — two coffees, three beers, two
 * train tickets — and the count comes first because that is the order the
 * words go in.
 *
 * What marks the money is the unit stuck to it, so the unit is what the
 * figure is read from: the one written into the same word for "$24", else the
 * nearest one behind it, else — for "CHF 24", where the unit leads — the
 * first one in front. Only a sentence with no unit at all falls back to the
 * first figure, because then there is nothing better to go on.
 */
function chooseAmount(
  figures: RegExpExecArray[],
  unit: Token | null,
): RegExpExecArray | null {
  if (figures.length === 0) return null;
  if (unit === null) return figures[0]!;

  const overlapping = figures.find(
    (f) => f.index < unit.end && f.index + f[0].length > unit.start,
  );
  if (overlapping) return overlapping;

  const behind = figures.filter((f) => f.index + f[0].length <= unit.start);
  if (behind.length > 0) return behind[behind.length - 1]!;

  return figures.find((f) => f.index >= unit.end) ?? figures[0]!;
}

export function heardEntry(
  spoken: string,
  fallbackCurrency = "",
  /**
   * Stretches of the sentence another reader has already claimed.
   *
   * Only `heardPeople` produces these, and only for a clause whose names it
   * actually resolved — "Anna paid", "split with me and Jonas". They are cut
   * out here rather than there because a clause is words in a sentence, and
   * this is the file that decides which words describe the money. Left
   * empty, nothing about this function changes.
   */
  skip: readonly HeardSpan[] = [],
): HeardEntry {
  const text = spoken.trim();
  if (text === "") {
    return { amountText: "", currency: "", description: "" };
  }

  /** Whether this word belongs to a clause somebody else has read. */
  const claimed = (token: Token): boolean =>
    skip.some(([from, to]) => token.start < to && token.end > from);

  const tokens = tokenize(text);
  let start = 0;
  /**
   * A clause has just been taken off the front, so an article may follow it.
   *
   * The same rule the description already keeps at its head, for the same
   * reason: an article goes only in something's wake. "Anna a payé le taxi"
   * leaves a "le" that belonged to the verb the reader has just been handed
   * as a chip, and English strips its "the" here anyway — a capital still
   * holds, so "Anna paid La Poste" keeps the shopfront.
   */
  let afterClause = false;
  while (start < tokens.length) {
    const token = tokens[start]!;
    if (claimed(token)) {
      afterClause = true;
      start += 1;
      continue;
    }
    const folded = fold(token.text);
    if (LEADING_WORDS.has(folded)) {
      afterClause = false;
      start += 1;
      continue;
    }
    if (afterClause && ARTICLES.has(folded) && !looksLikeName(token.text)) {
      afterClause = false;
      start += 1;
      continue;
    }
    break;
  }

  // The unit first, because it is what says which figure is the money.
  let currency = "";
  let unitAt = -1;
  for (let i = start; i < tokens.length; i += 1) {
    // A name is not a unit, whatever it is spelled like. Somebody called
    // Franc would otherwise put Swiss francs on a sentence said in euros, and
    // then take the euros' own word for the description.
    if (claimed(tokens[i]!)) continue;
    const code = currencyOf(tokens[i]!.text);
    if (code !== "") {
      currency = code;
      unitAt = i;
      break;
    }
  }
  const unit = unitAt === -1 ? null : tokens[unitAt]!;

  const chosen = chooseAmount([...text.matchAll(AMOUNT_ALL)], unit);
  const read = chosen ? readAmount(chosen[0]) : null;
  // The amount can span words — "1 500" is two of them — so what belongs to it
  // is settled by where it sat in the sentence rather than by any one word.
  const amountStart = chosen?.index ?? -1;
  const amountEnd = chosen ? chosen.index + chosen[0].length : -1;

  /*
   * "24 euros 50" is twenty-four fifty, said the way everybody says it aloud,
   * and it used to become 24 with a stray "50" heading the description. Only
   * two digits, and only directly after a unit that the figure itself came
   * before: that is the shape of cents, where "10 euros 3 beers" is not, and
   * a single digit after the unit is not something anybody says.
   */
  let cents = "";
  const after = unitAt === -1 ? undefined : tokens[unitAt + 1];
  if (
    unit !== null &&
    after !== undefined &&
    read !== null &&
    !read.decimal &&
    amountEnd <= unit.start &&
    CENTS.test(after.text)
  ) {
    cents = after.text;
  }
  const centsAt = cents === "" ? -1 : unitAt + 1;
  const centWordAt =
    cents !== "" && CENT_WORDS.has(fold(tokens[unitAt + 2]?.text ?? ""))
      ? unitAt + 2
      : -1;

  const kept: string[] = [];
  /** A preposition has been dropped, so an article may follow it out. */
  let joined = false;

  for (let i = start; i < tokens.length; i += 1) {
    if (i === unitAt || i === centsAt || i === centWordAt) continue;
    const token = tokens[i]!;
    if (claimed(token)) continue;
    // The amount itself is not part of what the money was for.
    if (chosen && token.start < amountEnd && token.end > amountStart) continue;

    const folded = fold(token.text);
    if (folded === "") continue;

    // Whatever joins the figure to the thing bought is not the thing bought.
    if (read !== null && kept.length === 0 && !looksLikeName(token.text)) {
      if (PREPOSITIONS.has(folded)) {
        joined = true;
        continue;
      }
      if (joined && ARTICLES.has(folded)) continue;
    }

    kept.push(token.text);
  }

  /*
   * And the same words go from the end, for the sentences that put the figure
   * last: "I bought coffee for 5 francs" is a coffee, not a "coffee for".
   */
  while (read !== null && kept.length > 0) {
    const last = kept[kept.length - 1]!;
    const folded = fold(last);
    if (looksLikeName(last)) break;
    if (!PREPOSITIONS.has(folded) && !ARTICLES.has(folded)) break;
    kept.pop();
  }

  const amountText =
    read === null ? "" : cents === "" ? read.text : `${read.text}.${cents}`;

  /*
   * The seam a removed clause leaves behind.
   *
   * "Anna paid the 120 taxi, split with me and Jonas" ends its description on
   * the comma that used to join it to the split — punctuation that only made
   * sense next to the words that are gone. Only ever tidied where something
   * was actually taken out, so a sentence nobody claimed comes back exactly
   * as it did before.
   */
  const words = kept.join(" ").trim();
  const description = skip.length === 0 ? words : words.replace(/[.,;:]+$/, "");

  return {
    amountText,
    // A sentence with no currency in it does not mean "no currency".
    currency: currency || fallbackCurrency,
    description,
  };
}
