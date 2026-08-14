/**
 * How people actually pay each other back.
 *
 * Two things make this list worth curating rather than free-typing:
 *
 *  1. **It is regional.** A Swiss group settles by TWINT, a Dutch one by
 *     Tikkie, an American one by Venmo. Offering all thirty at once buries the
 *     one method a given group will use every single time.
 *  2. **It is not closed.** Payment habits change faster than migrations, so
 *     the column is free text and an unrecognised method is still recorded
 *     verbatim. This list decides what is *offered*, never what is *allowed*.
 *
 * Identifiers are stable codes; the labels live in `messages/*.json` under
 * `paymentMethods`, so a translation never changes stored data. Brand names
 * are the same in every locale and are stored as their own label.
 */

export type PaymentMethodKind = "brand" | "cash" | "bank";

/**
 * Every code, as a union.
 *
 * Not decoration: the labels live in `messages/*.json` under `paymentMethods`,
 * and next-intl types `t()` against that catalogue. Keeping the ids a union is
 * what makes "added a method but forgot to translate it" a compile error
 * instead of a raw `payment_method_id` appearing on someone's settle screen.
 */
export const PAYMENT_METHOD_IDS = [
  "alipay",
  "apple_pay",
  "bancomat_pay",
  "bank",
  "blik",
  "bizum",
  "cash",
  "cash_app",
  "cheque",
  "crypto",
  "google_pay",
  "interac",
  "lydia",
  "mbway",
  "mobilepay",
  "monzo",
  "n26",
  "payconiq",
  "payid",
  "paypal",
  "pix",
  "revolut",
  "satispay",
  "swish",
  "tikkie",
  "twint",
  "upi",
  "venmo",
  "vipps",
  "wechat_pay",
  "wero",
  "wise",
  "zelle",
] as const;

export type PaymentMethodId = (typeof PAYMENT_METHOD_IDS)[number];

export interface PaymentMethod {
  /** Stable code — this is what goes in the database. */
  readonly id: PaymentMethodId;
  readonly kind: PaymentMethodKind;
  /**
   * Brand hue for the lettermark tile.
   *
   * PLACEHOLDER. The design calls for each provider's official SVG mark; these
   * are approximations standing in until those assets are licensed and added.
   */
  readonly brandColor?: string;
  /** Whether the lettermark reads better in white or in the app's plum. */
  readonly onBrand?: "light" | "dark";
  /**
   * Extra search terms. Someone in France looking for a bank transfer types
   * "virement", not "bank" — and finds it, without us storing three rows that
   * all mean the same movement of money.
   */
  readonly aliases?: readonly string[];
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  { id: "alipay", kind: "brand", brandColor: "#1677ff", onBrand: "light" },
  { id: "apple_pay", kind: "brand", brandColor: "#000000", onBrand: "light" },
  {
    id: "bancomat_pay",
    kind: "brand",
    brandColor: "#004b87",
    onBrand: "light",
    aliases: ["bancomat"],
  },
  {
    id: "bank",
    kind: "bank",
    // The regional names for one and the same transfer.
    aliases: [
      "virement",
      "überweisung",
      "uberweisung",
      "bank transfer",
      "wire",
      "iban",
      "sepa",
    ],
  },
  { id: "blik", kind: "brand", brandColor: "#000000", onBrand: "light" },
  { id: "bizum", kind: "brand", brandColor: "#00b3d3", onBrand: "light" },
  { id: "cash", kind: "cash", aliases: ["espèces", "especes", "bargeld"] },
  { id: "cash_app", kind: "brand", brandColor: "#00d54b", onBrand: "dark" },
  { id: "cheque", kind: "bank", aliases: ["check", "chèque"] },
  { id: "crypto", kind: "brand", brandColor: "#f7931a", onBrand: "dark" },
  { id: "google_pay", kind: "brand", brandColor: "#4285f4", onBrand: "light" },
  {
    id: "interac",
    kind: "brand",
    brandColor: "#fdb913",
    onBrand: "dark",
    aliases: ["interac e-transfer", "e-transfer"],
  },
  { id: "lydia", kind: "brand", brandColor: "#0068ff", onBrand: "light" },
  {
    id: "mbway",
    kind: "brand",
    brandColor: "#e30613",
    onBrand: "light",
    aliases: ["mb way"],
  },
  { id: "mobilepay", kind: "brand", brandColor: "#5a78ff", onBrand: "light" },
  { id: "monzo", kind: "brand", brandColor: "#ff4f40", onBrand: "light" },
  { id: "n26", kind: "brand", brandColor: "#36a18b", onBrand: "light" },
  {
    id: "payconiq",
    kind: "brand",
    brandColor: "#ff4785",
    onBrand: "light",
    // Rebranding from "Payconiq by Bancontact" to "Bancontact Pay" through
    // 2026. Both names find it, because people will say both for years.
    aliases: ["payconiq", "bancontact", "bancontact pay"],
  },
  { id: "payid", kind: "brand", brandColor: "#7a3ff2", onBrand: "light" },
  { id: "paypal", kind: "brand", brandColor: "#003087", onBrand: "light" },
  { id: "pix", kind: "brand", brandColor: "#32bcad", onBrand: "light" },
  { id: "revolut", kind: "brand", brandColor: "#0666eb", onBrand: "light" },
  { id: "satispay", kind: "brand", brandColor: "#f94b4b", onBrand: "light" },
  { id: "swish", kind: "brand", brandColor: "#ee1c25", onBrand: "light" },
  { id: "tikkie", kind: "brand", brandColor: "#f5c400", onBrand: "dark" },
  { id: "twint", kind: "brand", brandColor: "#000000", onBrand: "light" },
  { id: "upi", kind: "brand", brandColor: "#097939", onBrand: "light" },
  { id: "venmo", kind: "brand", brandColor: "#008cff", onBrand: "light" },
  { id: "vipps", kind: "brand", brandColor: "#ff5b24", onBrand: "light" },
  { id: "wechat_pay", kind: "brand", brandColor: "#07c160", onBrand: "light" },
  {
    id: "wero",
    kind: "brand",
    brandColor: "#1d1d3c",
    onBrand: "light",
    // The name people in France still reach for; Paylib folded into Wero.
    aliases: ["paylib", "epi"],
  },
  { id: "wise", kind: "brand", brandColor: "#9fe870", onBrand: "dark" },
  { id: "zelle", kind: "brand", brandColor: "#6d1ed4", onBrand: "light" },
] as const;

const BY_ID = new Map<string, PaymentMethod>(
  PAYMENT_METHODS.map((method) => [method.id, method]),
);

export function findPaymentMethod(id: string): PaymentMethod | undefined {
  return BY_ID.get(id);
}

/**
 * ISO 3166-1 alpha-2 codes we have an opinion about.
 *
 * Everywhere else falls back to `DEFAULT_METHODS`, which is deliberately dull:
 * guessing wrong is worse than offering the methods that work anywhere.
 *
 * **Ranked by how people pay a friend back**, which is not the same as how
 * they pay a shop. Cards dominate retail almost everywhere and appear nowhere
 * here; a domestic instant-transfer scheme that barely registers at a till can
 * be the only thing anyone uses to settle a dinner.
 *
 * Each list is four long, ordered most-likely first. The settle row shows the
 * first three — see `methodsForCountry` — and the picker's "Common in …"
 * section shows all four.
 *
 * Verified August 2026. Rationale per country, so a future edit can argue with
 * the reasoning rather than guess at it:
 *
 *  - **CH** TWINT is effectively universal for P2P; Revolut has strong uptake.
 *  - **FR/DE/BE** Wero (EPI) launched for P2P across all three in H2 2024 and
 *    passed 43.5m registered users, so it earns a slot alongside each
 *    country's incumbent — Lydia in France, PayPal in Germany, and in Belgium
 *    Payconiq/Bancontact, which alone carried 70.4m payments between friends
 *    in 2024.
 *  - **GB** Faster Payments is the default way to pay someone back — 5.6bn
 *    transactions, the second most-used payment method in the country — so
 *    plain bank transfer leads, ahead of Revolut and Monzo.
 *  - **US** Venmo leads on people (≈62% of P2P users), Zelle on money
 *    (\$1.2tn in 2025), Cash App on a third of the market. Bank transfer is
 *    Zelle here, so it is not listed twice.
 *  - **IT** Satispay leads the independent wallets; Bancomat Pay is the
 *    interbank scheme and the second most popular method.
 *  - **Nordics** Vipps MobilePay is one company now: Vipps in Norway,
 *    MobilePay in Denmark and Finland, Swish in Sweden.
 *  - **ES/PT/PL/BR/IN/CA/AU** each have one scheme that everybody uses —
 *    Bizum, MB WAY, BLIK, PIX, UPI, Interac e-Transfer, PayID.
 */
export const METHODS_BY_COUNTRY = {
  CH: ["twint", "cash", "bank", "revolut"],
  FR: ["lydia", "wero", "cash", "bank"],
  DE: ["paypal", "wero", "cash", "bank"],
  BE: ["payconiq", "wero", "cash", "bank"],
  GB: ["bank", "revolut", "cash", "monzo"],
  IE: ["revolut", "bank", "cash", "paypal"],
  // Cash sits third rather than fourth on purpose. Cash App is genuinely a
  // top-three US app, but "Cash App" one slot from "Cash" is a misread waiting
  // to happen, and handing over a note must never cost a tap.
  US: ["venmo", "zelle", "cash", "cash_app"],
  NL: ["tikkie", "cash", "bank", "paypal"],
  AT: ["paypal", "cash", "bank", "revolut"],
  IT: ["satispay", "bancomat_pay", "cash", "bank"],
  ES: ["bizum", "cash", "bank", "paypal"],
  PL: ["blik", "cash", "bank", "revolut"],
  SE: ["swish", "cash", "bank", "revolut"],
  NO: ["vipps", "cash", "bank", "revolut"],
  DK: ["mobilepay", "cash", "bank", "revolut"],
  FI: ["mobilepay", "cash", "bank", "revolut"],
  PT: ["mbway", "cash", "bank", "paypal"],
  BR: ["pix", "cash", "bank", "paypal"],
  IN: ["upi", "cash", "bank", "google_pay"],
  CA: ["interac", "cash", "bank", "paypal"],
  AU: ["payid", "cash", "bank", "paypal"],
} as const satisfies Record<string, readonly PaymentMethodId[]>;

/** Countries the picker has an opinion about, and that `countries` translates. */
export type SupportedCountry = keyof typeof METHODS_BY_COUNTRY;

export const DEFAULT_METHODS: readonly PaymentMethodId[] = [
  "cash",
  "bank",
  "paypal",
  "revolut",
];

/** How many the settle row has space for; the rest live in the picker. */
export const ROW_METHOD_COUNT = 3;

/**
 * The methods to offer for a country, most likely first.
 *
 * Unknown codes and unknown method ids both fall back rather than throw: a
 * settle-up screen that renders nothing because of a country code is a far
 * worse failure than one offering Cash and Bank.
 */
export function methodsForCountry(
  country: string | null | undefined,
): readonly PaymentMethodId[] {
  const listed = country
    ? METHODS_BY_COUNTRY[country.toUpperCase() as SupportedCountry]
    : undefined;
  const resolved: PaymentMethodId[] = [...(listed ?? DEFAULT_METHODS)].filter(
    (id) => BY_ID.has(id),
  );
  // Pad rather than discard: one unrecognised entry should cost that one slot,
  // not the whole country's list.
  for (const fallback of DEFAULT_METHODS) {
    if (resolved.length >= ROW_METHOD_COUNT) break;
    if (!resolved.includes(fallback)) resolved.push(fallback);
  }
  return resolved;
}

/**
 * Country for an IANA timezone.
 *
 * The group already stores a timezone, detected from the browser when the
 * group was created, which makes it the best country signal on hand — better
 * than the base currency, which says nothing (EUR spans twenty countries) and
 * better than asking, which is one more question on a form nobody enjoys.
 *
 * Only zones whose country we actually have an opinion about are listed;
 * anything else returns null and takes the default methods. A group left on
 * the "UTC" default is exactly that case.
 */
const COUNTRY_BY_TIMEZONE = {
  "Europe/Zurich": "CH",
  "Europe/Geneva": "CH",
  "Europe/Basel": "CH",
  "Europe/Paris": "FR",
  "Europe/Berlin": "DE",
  "Europe/Munich": "DE",
  "Europe/London": "GB",
  "Europe/Dublin": "IE",
  "Europe/Amsterdam": "NL",
  "Europe/Brussels": "BE",
  "Europe/Vienna": "AT",
  "Europe/Rome": "IT",
  "Europe/Madrid": "ES",
  "Europe/Lisbon": "PT",
  "Europe/Warsaw": "PL",
  "Europe/Stockholm": "SE",
  "Europe/Oslo": "NO",
  "Europe/Copenhagen": "DK",
  "Europe/Helsinki": "FI",
  "America/New_York": "US",
  "America/Chicago": "US",
  "America/Denver": "US",
  "America/Los_Angeles": "US",
  "America/Toronto": "CA",
  "America/Vancouver": "CA",
  "America/Sao_Paulo": "BR",
  "Asia/Kolkata": "IN",
  "Asia/Calcutta": "IN",
  "Australia/Sydney": "AU",
  "Australia/Melbourne": "AU",
} as const satisfies Record<string, SupportedCountry>;

export function countryForTimezone(
  timezone: string | null | undefined,
): SupportedCountry | null {
  if (!timezone) return null;
  return (
    COUNTRY_BY_TIMEZONE[timezone as keyof typeof COUNTRY_BY_TIMEZONE] ?? null
  );
}

/**
 * Ranks methods for the search sheet.
 *
 * Matches on the code, the supplied label, and any alias, so "virement" finds
 * the bank transfer and "espèces" finds cash. A prefix match outranks a match
 * in the middle of a word, which is what makes typing "ca" put Cash above
 * Interac.
 */
export function searchPaymentMethods(
  query: string,
  labelOf: (id: string) => string,
): readonly PaymentMethod[] {
  const needle = normalize(query);
  if (needle === "") return PAYMENT_METHODS;

  const scored: { method: PaymentMethod; score: number }[] = [];
  for (const method of PAYMENT_METHODS) {
    const haystacks = [
      normalize(labelOf(method.id)),
      normalize(method.id.replace(/_/g, " ")),
      ...(method.aliases ?? []).map(normalize),
    ];
    let best = -1;
    for (const haystack of haystacks) {
      if (haystack.startsWith(needle)) best = Math.max(best, 2);
      else if (haystack.includes(needle)) best = Math.max(best, 1);
    }
    if (best > 0) scored.push({ method, score: best });
  }

  return scored
    .sort(
      (a, b) =>
        b.score - a.score ||
        labelOf(a.method.id).localeCompare(labelOf(b.method.id)),
    )
    .map((entry) => entry.method);
}

/** Case- and accent-insensitive, so "especes" matches "espèces". */
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}
