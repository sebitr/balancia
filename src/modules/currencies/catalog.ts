/**
 * What a currency looks like to a reader: its name, its symbol, its flag, and
 * the words someone might search for it by.
 *
 * `iso-4217.ts` next door is the ledger's view — code and exponent, the two
 * things that decide what an amount *is*. This is the picker's view, and none
 * of it is allowed to influence arithmetic.
 *
 * Names, symbols and country names come from `Intl` rather than from a table
 * written here. The app ships in two languages and the list is a hundred and
 * fifty-six long: a hand-written table would be three hundred and twelve
 * strings to keep in step, and every one of them would be a chance for the
 * French column to drift from the English. What `Intl` cannot supply is
 * written below and only that — flags, the handful of currencies no single
 * country issues, and the place names people actually type.
 */

import { SUPPORTED_CURRENCIES } from "./iso-4217";

export interface CurrencyEntry {
  readonly code: string;
  /** Localised, capitalised: "Franc suisse", "Swiss Franc". */
  readonly name: string;
  /** "Fr.", "€", "$" — empty when the currency has no symbol but its code. */
  readonly symbol: string;
  /** A bare emoji flag. Never a placeholder tile: see the picker. */
  readonly flag: string;
  /** Everything the row can be found by, already normalised for search. */
  readonly keywords: string;
}

/**
 * Currencies whose first two letters are not the country that issues them.
 *
 * The default rule — CHF is Switzerland, JPY is Japan — holds for all but
 * these. The `X` codes belong to a currency union rather than a country, so
 * they get the members instead: someone looking for the CFA franc is far more
 * likely to type "Sénégal" than "BCEAO".
 */
const REGIONS: Record<string, readonly string[]> = {
  // The Netherlands Antilles dissolved in 2010. `AN` still resolves, but the
  // flag it would build does not exist.
  ANG: ["CW", "SX"],
  XCG: ["CW", "SX"],
  EUR: [
    "EU",
    "FR",
    "DE",
    "IT",
    "ES",
    "PT",
    "NL",
    "BE",
    "AT",
    "IE",
    "GR",
    "FI",
    "SK",
    "SI",
    "HR",
    "LT",
    "LV",
    "EE",
    "LU",
    "CY",
    "MT",
  ],
  XAF: ["CM", "GA", "TD", "CG", "CF", "GQ"],
  XOF: ["SN", "CI", "ML", "BJ", "BF", "TG", "NE", "GW"],
  XPF: ["PF", "NC", "WF"],
  XCD: ["AG", "GD", "LC", "DM", "VC", "KN", "AI", "MS"],
};

/**
 * Flags for the currencies no flag can be derived for.
 *
 * A currency union has no flag of its own, and the design is explicit that a
 * coloured placeholder box is not an answer — so the region stands in for the
 * country. The euro is the exception that works: 🇪🇺 exists.
 */
const FLAGS: Record<string, string> = {
  ANG: "🇨🇼",
  XCG: "🇨🇼",
  XAF: "🌍",
  XOF: "🌍",
  XCD: "🏝️",
  XPF: "🏝️",
};

/**
 * Where people go, as opposed to what the country is called.
 *
 * Search already covers every country name in the reader's own language, which
 * leaves the gap this closes: the holiday is booked to Bali, not to Indonesia,
 * and the layover is in Dubai rather than in the United Arab Emirates. Place
 * names only — anything that translates belongs in `REGIONS` above, where
 * `Intl` will localise it for free.
 */
const ALIASES: Record<string, readonly string[]> = {
  AED: ["Dubaï", "Abu Dhabi"],
  ARS: ["Buenos Aires", "Patagonie"],
  CZK: ["Prague"],
  EGP: ["Le Caire", "Louxor", "Charm el-Cheikh"],
  HUF: ["Budapest"],
  IDR: ["Bali", "Java", "Lombok"],
  ISK: ["Reykjavik"],
  JPY: ["Tokyo", "Kyoto", "Osaka"],
  MAD: ["Marrakech", "Casablanca", "Agadir"],
  MVR: ["Maldives", "Malé"],
  PLN: ["Cracovie", "Varsovie"],
  THB: ["Bangkok", "Phuket", "Koh Samui"],
  TRY: ["Istanbul", "Antalya", "Cappadoce"],
  USD: ["New York", "Californie", "Floride"],
  VND: ["Hanoï", "Saïgon", "Hô Chi Minh"],
  XPF: ["Tahiti", "Bora-Bora"],
};

/**
 * Accent- and case-insensitive, so `etats` finds the United States and `chf`
 * finds the Swiss franc. Applied to both sides of every comparison — a needle
 * normalised differently from the haystack matches nothing.
 */
export function normaliseForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** The two-letter region code as regional-indicator symbols: "CH" → 🇨🇭. */
function flagOf(region: string): string {
  return [...region]
    .map((letter) => String.fromCodePoint(0x1f1e6 + letter.charCodeAt(0) - 65))
    .join("");
}

/**
 * One currency's flag, and nothing else about it.
 *
 * A heading that groups figures by currency wants the flag on its own, and
 * `currencyEntry` would build the whole hundred-and-fifty-six-row catalogue to
 * hand it over. Nothing about a flag is localised, so this asks for no locale.
 */
export function currencyFlag(code: string): string {
  return FLAGS[code] ?? flagOf((REGIONS[code] ?? [code.slice(0, 2)])[0]!);
}

/**
 * French currency names arrive lowercased ("franc suisse") and English ones
 * capitalised. The row is a standalone line either way, so it starts on a
 * capital either way.
 */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The symbol, or nothing.
 *
 * Fifty-odd currencies have no symbol distinct from their code, and `Intl`
 * says so by handing the code back. Printing it would put "AED AED" in a row
 * whose whole point is that the code is already the first thing in it.
 */
function symbolOf(code: string, locale: string): string {
  try {
    const symbol = new Intl.NumberFormat(locale, {
      style: "currency",
      currency: code,
      currencyDisplay: "narrowSymbol",
    })
      .formatToParts(1)
      .find((part) => part.type === "currency")?.value;
    return symbol === undefined || symbol === code ? "" : symbol;
  } catch {
    return "";
  }
}

function buildCatalogue(locale: string): readonly CurrencyEntry[] {
  const currencyNames = new Intl.DisplayNames([locale], { type: "currency" });
  const regionNames = new Intl.DisplayNames([locale], {
    type: "region",
    fallback: "none",
  });

  return SUPPORTED_CURRENCIES.map(({ code }) => {
    const regions = REGIONS[code] ?? [code.slice(0, 2)];
    const countries = regions
      .map((region) => {
        try {
          return regionNames.of(region);
        } catch {
          return undefined;
        }
      })
      .filter((name): name is string => name !== undefined);

    // `Intl` hands the code back for a currency it has no name for. Better the
    // code twice than an empty second line.
    const name = capitalise(currencyNames.of(code) ?? code);

    return {
      code,
      name,
      symbol: symbolOf(code, locale),
      flag: currencyFlag(code),
      keywords: normaliseForSearch(
        [code, name, ...countries, ...(ALIASES[code] ?? [])].join(" "),
      ),
    };
  });
}

/**
 * Built once per language and kept.
 *
 * A hundred and fifty-six `Intl.DisplayNames` lookups is not free, and the
 * picker rebuilds its list on every keystroke.
 */
const catalogues = new Map<string, readonly CurrencyEntry[]>();

export function currencyCatalogue(locale: string): readonly CurrencyEntry[] {
  const cached = catalogues.get(locale);
  if (cached) return cached;
  const built = buildCatalogue(locale);
  catalogues.set(locale, built);
  return built;
}

/** One currency, for a trigger that shows what is already chosen. */
export function currencyEntry(
  code: string,
  locale: string,
): CurrencyEntry | undefined {
  return currencyCatalogue(locale).find((entry) => entry.code === code);
}

/**
 * Everything matching a query, in the order the catalogue is in.
 *
 * An empty query matches everything — the caller decides whether that means
 * "show the whole list" or "show favourites first", because those are the two
 * different screens the picker has.
 */
export function searchCurrencies(
  entries: readonly CurrencyEntry[],
  query: string,
): readonly CurrencyEntry[] {
  const needle = normaliseForSearch(query.trim());
  if (needle === "") return entries;
  return entries.filter((entry) => entry.keywords.includes(needle));
}
