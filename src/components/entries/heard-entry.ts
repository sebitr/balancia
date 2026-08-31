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
 */
const SPOKEN_CURRENCIES: Readonly<Record<string, string>> = {
  franc: "CHF",
  francs: "CHF",
  balles: "CHF",
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

/** Words that only ever introduce the entry, never describe it. */
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
]);

/**
 * The first number in the sentence, as the amount field wants it.
 *
 * "24.50" and "24,50" are the same figure said two ways. The run has to be
 * bounded by non-digits at both ends, so a long one produces no amount at
 * all: 0041791234567 is a phone number, and finding "91234567" inside it
 * would put a figure in the field that nobody said.
 */
const AMOUNT = /(?<!\d)(\d{1,8})(?:[.,](\d{1,2}))?(?!\d)/;

/** A word reduced to the letters and digits a rule can match against. */
function fold(word: string): string {
  return foldText(word).replace(/[^a-z0-9]/g, "");
}

export function heardEntry(spoken: string, fallbackCurrency = ""): HeardEntry {
  const text = spoken.trim();
  if (text === "") {
    return { amountText: "", currency: "", description: "" };
  }

  const match = AMOUNT.exec(text);
  const amountText = match
    ? match[2] === undefined
      ? match[1]!
      : `${match[1]}.${match[2]}`
    : "";

  /*
   * Scaffolding comes off the front of the *sentence*, not off the front of
   * whatever survives. "note" introduces an entry in "note 12 francs" and is
   * a thing you buy in "12 francs note book", and where it was said is the
   * only thing telling those apart.
   */
  const words = text.split(/\s+/).filter((word) => word !== "");
  let start = 0;
  while (start < words.length && LEADING_WORDS.has(fold(words[start]!))) {
    start += 1;
  }

  let currency = "";
  let amountTaken = false;
  const kept: string[] = [];

  for (const word of words.slice(start)) {
    const folded = fold(word);
    if (folded === "") continue;

    // The amount itself is not part of what the money was for. Only the first
    // one: "2 coffees 8 francs" describes two coffees.
    if (!amountTaken && match && word.includes(match[0])) {
      amountTaken = true;
      continue;
    }

    if (currency === "") {
      const spokenCode = SPOKEN_CURRENCIES[folded];
      if (spokenCode) {
        currency = spokenCode;
        continue;
      }
      const upper = word.toUpperCase().replace(/[^A-Z]/g, "");
      if (upper.length === 3 && SUPPORTED_CURRENCY_CODES.includes(upper)) {
        currency = upper;
        continue;
      }
    }

    kept.push(word);
  }

  return {
    amountText,
    // A sentence with no currency in it does not mean "no currency".
    currency: currency || fallbackCurrency,
    description: kept.join(" ").trim(),
  };
}
