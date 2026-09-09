import { foldText } from "@/modules/categorization";
import { SUPPORTED_CURRENCY_CODES } from "@/modules/currencies/iso-4217";

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
 * Deliberately not here: the payer and "just me". They are one tap in a sheet
 * that shows faces, and a misheard *name* is the correction people most often
 * have to make — guessing at one would spend the trust the rest of this buys.
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
 * Two shapes: a grouped one — "1 500", "1,500", "2,499.99" — and a plain run
 * of digits. The grouped shape is tried first, because a plain run would
 * match "1" out of "1,500" and hand the form a rent of one franc. Both are
 * bounded by non-digits at either end, so a long run produces nothing at all:
 * 0041791234567 is a phone number, and finding "91234567" inside it would put
 * a figure in the field that nobody said.
 */
const AMOUNT =
  /(?<!\d)(?:\d{1,3}(?:[   .,]\d{3})+|\d{1,8})(?:[.,]\d{1,2})?(?!\d)/;

/** A run of two digits, which is how cents are said after the unit. */
const CENTS = /^\d{2}$/;

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
 * puts the two marks. Spaces only ever group.
 */
function readAmount(raw: string): { text: string; decimal: boolean } {
  const compact = raw.replace(/[   ]/g, "");
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

export function heardEntry(spoken: string, fallbackCurrency = ""): HeardEntry {
  const text = spoken.trim();
  if (text === "") {
    return { amountText: "", currency: "", description: "" };
  }

  const match = AMOUNT.exec(text);
  const read = match ? readAmount(match[0]) : null;
  // The amount can span words — "1 500" is two of them — so what belongs to it
  // is settled by where it sat in the sentence rather than by any one word.
  const amountStart = match?.index ?? -1;
  const amountEnd = match ? match.index + match[0].length : -1;

  const tokens = tokenize(text);
  let start = 0;
  while (start < tokens.length && LEADING_WORDS.has(fold(tokens[start]!.text))) {
    start += 1;
  }

  let currency = "";
  let cents = "";
  let amountTaken = false;
  /** A preposition has been dropped, so an article may follow it out. */
  let joined = false;
  const kept: string[] = [];

  for (let i = start; i < tokens.length; i += 1) {
    const token = tokens[i]!;
    const word = token.text;

    // Read any sign before the word can be dropped for being the amount:
    // "$24" is both, and taking it as the amount alone loses the dollars.
    if (currency === "") {
      const symbol = symbolCurrency(word);
      if (symbol !== "") currency = symbol;
    }

    // The amount itself is not part of what the money was for. Only the first
    // one: "2 coffees 8 francs" describes two coffees.
    if (match && token.start < amountEnd && token.end > amountStart) {
      amountTaken = true;
      continue;
    }

    const folded = fold(word);
    if (folded === "") continue;

    if (currency === "") {
      const spokenCode = SPOKEN_CURRENCIES[folded];
      const upper = word.toUpperCase().replace(/[^A-Z]/g, "");
      const code =
        spokenCode ??
        (upper.length === 3 && SUPPORTED_CURRENCY_CODES.includes(upper)
          ? upper
          : "");
      if (code !== "") {
        currency = code;
        /*
         * "24 euros 50" is twenty-four fifty, said the way everybody says it
         * aloud — and it used to become 24 with a stray "50" at the front of
         * the description. Only ever two digits, and only directly after the
         * unit: that is the shape of cents, where "10 euros 3 beers" is not,
         * and a single digit after the unit is not something anybody says.
         */
        const next = tokens[i + 1]?.text ?? "";
        if (amountTaken && read !== null && !read.decimal && CENTS.test(next)) {
          cents = next;
          i += 1;
        }
        continue;
      }
    }

    // Whatever joins the figure to the thing bought is not the thing bought.
    if (amountTaken && kept.length === 0 && !looksLikeName(word)) {
      if (PREPOSITIONS.has(folded)) {
        joined = true;
        continue;
      }
      if (joined && ARTICLES.has(folded)) continue;
    }

    kept.push(word);
  }

  const amountText =
    read === null ? "" : cents === "" ? read.text : `${read.text}.${cents}`;

  return {
    amountText,
    // A sentence with no currency in it does not mean "no currency".
    currency: currency || fallbackCurrency,
    description: kept.join(" ").trim(),
  };
}
