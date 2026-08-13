import { isSupportedCurrency } from "@/modules/currencies/iso-4217";

/**
 * The words receipts use for the numbers at the bottom.
 *
 * Matching is accent-folded and case-insensitive, and the vocabulary is
 * language-agnostic on purpose: a receipt does not declare what language it is
 * in, and a Swiss one is routinely printed in two at once. The lists are keyed
 * by language only so they stay maintainable.
 *
 * Order matters in exactly one place, and it matters a lot: **subtotal is
 * tested before total**, because every word for "subtotal" contains a word for
 * "total" (`sous-total`, `Zwischensumme`, `totale parziale`). Getting that
 * backwards reads the subtotal as the total and quietly under-charges the
 * table.
 */

/** Folds case and accents so `MwSt.`, `mwst` and `TVA`/`tva` all compare equal. */
export function foldLabel(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, " ")
    .trim();
}

/** Tested before `TOTAL_WORDS`; see the note above. */
const SUBTOTAL_WORDS = [
  // en
  "subtotal",
  "sub total",
  "net total",
  "net amount",
  // fr
  "sous total",
  "soustotal",
  "total intermediaire",
  "montant ht",
  "total ht",
  // de
  "zwischensumme",
  "zwischen summe",
  "nettobetrag",
  "netto",
  "warenwert",
  // it
  "subtotale",
  "totale parziale",
  "parziale",
  "imponibile",
  // es / pt
  "subtotal",
  "base imponible",
  "total parcial",
  // nl
  "subtotaal",
];

const TOTAL_WORDS = [
  // en
  "total",
  "grand total",
  "total due",
  "amount due",
  "balance due",
  "amount",
  "total amount",
  "sum",
  "tot",
  "to pay",
  "you pay",
  "total sale",
  // fr
  "montant",
  "montant total",
  "total ttc",
  "net a payer",
  "a payer",
  "total a payer",
  "somme",
  "total du",
  // de
  "gesamt",
  "gesamtbetrag",
  "gesamtsumme",
  "summe",
  "betrag",
  "endbetrag",
  "zu zahlen",
  "zahlbetrag",
  "rechnungsbetrag",
  "total chf",
  "brutto",
  // it
  "totale",
  "totale complessivo",
  "totale euro",
  "importo",
  "da pagare",
  "totale documento",
  // es / pt
  "importe",
  "importe total",
  "total a pagar",
  "a pagar",
  // nl / nordics
  "totaal",
  "te betalen",
  "att betala",
  "at betale",
  "yhteensa",
];

const TAX_WORDS = [
  // en
  "tax",
  "sales tax",
  "vat",
  "gst",
  "hst",
  "pst",
  "qst",
  // fr
  "tva",
  "t v a",
  "taxe",
  "taxes",
  // de
  "mwst",
  "mw st",
  "mehrwertsteuer",
  "ust",
  "umsatzsteuer",
  "steuer",
  // it / es / pt
  "iva",
  "imposta",
  // nl / nordics / other
  "btw",
  "moms",
  "alv",
  "dph",
  "pdv",
  "ptu",
  "vat total",
];

const TIP_WORDS = [
  "tip",
  "tips",
  "gratuity",
  "trinkgeld",
  "pourboire",
  "mancia",
  "propina",
  "fooi",
  "dricks",
  "drikkepenge",
];

const SERVICE_WORDS = [
  "service",
  "service charge",
  "servizio",
  "coperto",
  "bedienung",
  "servicio",
  "frais de service",
  "service compris",
  "couvert",
];

/**
 * Lines that are never an item, however much they look like one.
 *
 * Kept narrow on purpose. Every word here also removes a possible menu item —
 * `table` would take `table d'hôte` with it — so the list holds only words
 * that no kitchen puts on a bill. Layout furniture with no price (`Thank you`,
 * `Table 12`) is already dropped by the parser, which requires an item to end
 * in something shaped like a price.
 */
const NOISE_WORDS = [
  // Payment and change: these do carry an amount, and it is not the bill.
  "cash",
  "change",
  "card",
  "credit card",
  "debit card",
  "visa",
  "mastercard",
  "maestro",
  "amex",
  "karte",
  "wechselgeld",
  "rueckgeld",
  "ruckgeld",
  "rendu",
  "monnaie",
  "especes",
  "espece",
  "carte bancaire",
  "contant",
  "twint",
  "paypal",
  "contactless",
  "kontaktlos",
  "payment",
  "paiement",
  "zahlung",
  "pagamento",
  "given",
  "tendered",
  "cambio",
  "vuelto",
  "contanti",
  "resto",
  // Identifiers, which are digits that are not money.
  "vat no",
  "vat reg",
  "tva no",
  "ust id",
  "mwst nr",
  "steuer nr",
  "tax id",
  "p iva",
  "iva nr",
  "siret",
  "trx",
  "auth",
  "approval code",
  "terminal id",
  "customer copy",
  "merchant copy",
];

function containsWord(folded: string, words: readonly string[]): boolean {
  for (const word of words) {
    if (folded === word) return true;
    // Word-boundary containment: `total chf` matches inside `total chf 72 10`,
    // but `tot` must not match inside `total`.
    const pattern = new RegExp(`(^| )${escape(word)}( |$)`);
    if (pattern.test(folded)) return true;
  }
  return false;
}

function escape(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type AmountLabel = "subtotal" | "tax" | "tip" | "service" | "total";

/**
 * What a line's *words* say it is, ignoring its numbers.
 *
 * Returns `null` for anything that is not one of the summary rows — including
 * noise, which the parser drops rather than treating as an item.
 */
export function classifyLabel(text: string): AmountLabel | "noise" | null {
  const folded = foldLabel(text);
  if (folded === "") return "noise";

  // Subtotal first. Always.
  if (containsWord(folded, SUBTOTAL_WORDS)) return "subtotal";

  // Tax lines routinely embed a rate and a base (`MwSt 7.7% 5.10`), and some
  // print `Total MwSt` — which is a tax row, not the bill total.
  // Noise before everything else that carries a number. Two reasons, and both
  // have bitten: `P.IVA 03918270965` is a VAT *registration number* and
  // contains the word for tax, and `Cash amount 100.00` contains the word for
  // a grand total. Read either as what it resembles and the bill comes out
  // wrong by whatever the customer happened to hand over.
  if (containsWord(folded, NOISE_WORDS)) return "noise";

  if (containsWord(folded, TAX_WORDS)) return "tax";
  if (containsWord(folded, TIP_WORDS)) return "tip";
  if (containsWord(folded, SERVICE_WORDS)) return "service";
  if (containsWord(folded, TOTAL_WORDS)) return "total";
  return null;
}

/* ------------------------------------------------------------- currency */

/**
 * Currency marks, most specific first: `CHF` must be tried before `Fr`, and
 * `R$` before `$`, or the wrong code wins on a string that contains both.
 */
const CURRENCY_MARKS: readonly (readonly [RegExp, string])[] = [
  [/\bCHF\b|\bSFR\b|\bFR\.?\s*\d/i, "CHF"],
  [/\bEUR\b|€/i, "EUR"],
  [/\bGBP\b|£/i, "GBP"],
  [/\bR\$/i, "BRL"],
  [/\bUSD\b|\bUS\$/i, "USD"],
  [/\bCAD\b|\bCA\$/i, "CAD"],
  [/\bAUD\b|\bA\$/i, "AUD"],
  [/\bJPY\b|¥/i, "JPY"],
  [/\bSEK\b/i, "SEK"],
  [/\bNOK\b/i, "NOK"],
  [/\bDKK\b/i, "DKK"],
  [/\bPLN\b|\bZŁ\b|\bZL\b/i, "PLN"],
  [/\bCZK\b|\bKČ\b|\bKC\b/i, "CZK"],
  [/\bHUF\b|\bFT\b/i, "HUF"],
  [/\bRON\b|\bLEI\b/i, "RON"],
  [/\bTRY\b|₺/i, "TRY"],
  [/\bINR\b|₹/i, "INR"],
  [/\bMXN\b/i, "MXN"],
  [/\bZAR\b/i, "ZAR"],
  // Bare `$` last: it is the ambiguous one, and everything that disambiguates
  // it has already been tried.
  [/\$/, "USD"],
];

/**
 * The currency a receipt names, or `null` when it names none.
 *
 * `null` is a normal outcome and the caller keeps the group's currency. A
 * receipt that says nothing must not be assumed to be in dollars.
 */
export function detectCurrency(text: string): string | null {
  for (const [pattern, code] of CURRENCY_MARKS) {
    if (pattern.test(text) && isSupportedCurrency(code)) return code;
  }
  return null;
}
