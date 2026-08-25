import { money, toMajorString } from "@/modules/currencies/money";

/**
 * The Swiss QR Code, as the payment part of a QR-bill.
 *
 * Swiss Implementation Guidelines for the QR-bill, v2.4 (SIX, 24.02.2026).
 * Thirty-one lines of it are compulsory; the two after the trailer are not,
 * and are left off.
 *
 * Three of its rules are the ones that turn a scannable code into a refused
 * payment, and all three are enforced by refusing to build the code at all
 * rather than by building one and hoping:
 *
 *  1. **Only CH and LI IBANs.** The standard is a domestic one. A German IBAN
 *     in a Swiss QR is not a lenient case, it is a different scheme.
 *  2. **A QR-IBAN is not usable here.** An IBAN whose institution id falls in
 *     30000–31999 is a QR-IBAN, and the guidelines require it to carry a
 *     structured QR reference — 27 digits ending in a modulo-10 check digit,
 *     issued by the creditor's own bank for one specific invoice. Nothing in a
 *     shared-expense app can invent one, so an account like that gets no QR.
 *  3. **A structured address is compulsory.** Since v2.3 the address must be
 *     supplied in parts; the guidelines mark postcode and town `D*` — "due to
 *     the obligation to provide a structured address, the element must always
 *     be supplied" — and unstructured addresses stop being accepted by the
 *     Swiss payment infrastructure on 30 September 2026. Street and building
 *     number stay genuinely optional.
 *
 * Nothing here is a display string, so nothing is localised: the payload is
 * read by a bank, not by a person.
 */

export interface SwissCreditorAddress {
  /** Optional per the guidelines, and often genuinely absent. */
  readonly street: string | null;
  readonly buildingNumber: string | null;
  readonly postalCode: string;
  readonly town: string;
  /** ISO 3166-1 alpha-2. */
  readonly country: string;
}

export interface SwissQrInput {
  readonly iban: string;
  readonly creditorName: string;
  readonly address: SwissCreditorAddress;
  /** Minor units. Omitted leaves the amount open, which the standard allows. */
  readonly minorUnits?: string | null;
  readonly currency: string;
  /** The unstructured message, which is where a group's name goes. */
  readonly message?: string | null;
}

/** Only these two, per the guidelines. */
const CURRENCIES = new Set(["CHF", "EUR"]);

const MAX = {
  name: 70,
  street: 70,
  buildingNumber: 16,
  postalCode: 16,
  town: 35,
  message: 140,
} as const;

/**
 * The line the payment data ends on. Billing information and alternative
 * procedures come *after* it, which is the standard's own oddity and the
 * reason this is not simply the last line.
 */
const TRAILER = "EPD";

export function buildSwissQrPayload(input: SwissQrInput): string | null {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!isSwissIban(iban) || isQrIban(iban)) return null;
  if (!CURRENCIES.has(input.currency)) return null;

  const name = clean(input.creditorName, MAX.name);
  const postalCode = clean(input.address.postalCode, MAX.postalCode);
  const town = clean(input.address.town, MAX.town);
  const country = input.address.country.trim().toUpperCase();
  if (!name || !postalCode || !town || !/^[A-Z]{2}$/.test(country)) return null;

  const amount = formatAmount(input.minorUnits, input.currency);
  if (amount === null) return null;

  const lines = [
    "SPC", // 1 QRType
    "0200", // 2 Version — only "0200" is permitted in master version 02
    "1", // 3 Coding: UTF-8 restricted to the Latin character set
    iban, // 4
    "S", // 5 Address type: structured, the only one still accepted
    name, // 6
    clean(input.address.street, MAX.street), // 7 optional
    clean(input.address.buildingNumber, MAX.buildingNumber), // 8 optional
    postalCode, // 9
    town, // 10
    country, // 11
    // 12–18 Ultimate creditor. "The entire data group must not be filled in",
    // so the seven lines are present and empty rather than absent.
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    amount, // 19 — empty is allowed and means "the payer decides"
    input.currency, // 20
    // 21–27 Ultimate debtor: optional, and we do not know who is paying until
    // they have paid. Left empty rather than guessed at.
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "NON", // 28 Reference type: no structured reference
    "", // 29 Reference: "must not be filled for the reference type NON"
    clean(input.message, MAX.message), // 30 Unstructured message
    TRAILER, // 31
  ];

  return lines.join("\n");
}

/** CH and LI only — the standard is domestic to those two. */
function isSwissIban(iban: string): boolean {
  return /^(CH|LI)\d{2}[A-Z0-9]{17}$/.test(iban);
}

/**
 * Whether this is a QR-IBAN, which this code cannot serve.
 *
 * The institution identification sits in positions 5–9, and QR-IIDs are
 * exactly 30000–31999. Such an account may only be credited with a structured
 * QR reference issued for one invoice, so the honest answer is no code at all.
 */
export function isQrIban(iban: string): boolean {
  const compact = iban.replace(/\s/g, "").toUpperCase();
  if (!isSwissIban(compact)) return false;
  const iid = Number(compact.slice(4, 9));
  return Number.isInteger(iid) && iid >= 30000 && iid <= 31999;
}

/**
 * The amount, or an empty line.
 *
 * Null on a value the standard refuses, which is how an out-of-range amount
 * becomes "no QR" rather than a QR a bank will reject.
 */
function formatAmount(
  minorUnits: string | null | undefined,
  currency: string,
): string | null {
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") {
    return "";
  }
  let value: bigint;
  try {
    value = BigInt(minorUnits);
  } catch {
    return null;
  }
  if (value <= 0n) return null;
  const major = toMajorString(money(value, currency));
  // "Must be between 0.01 and 999,999,999.99", and at most twelve characters
  // including the decimal point.
  return major.length <= 12 ? major : null;
}

/** Trimmed, collapsed and cut to the length the standard allows. */
function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}
