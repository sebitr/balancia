import { money, toMajorString } from "@/modules/currencies/money";

/**
 * The Swish QR code, for a payment between two people.
 *
 * > Not to be confused with `swiss.ts` beside it, which is the Swiss QR-bill.
 * > One letter apart, one country apart, and nothing else in common.
 *
 * Swish's *merchant* flow is what makes people assume this cannot be built
 * here: a Swish Handel deep link carries a token minted by a server-side call
 * to the Merchant API, and nothing in this repository can mint one. But the
 * person-to-person code is a different artefact entirely and needs no API at
 * all — four fields, semicolon-separated, starting with a literal `C`:
 *
 *     C{swish number};{amount};{message};{editable}
 *
 * The empty ones still take their semicolons. A message of length zero is
 * `C46701234567;83.50;;0`, not `C46701234567;83.50;0`, and a reader that gets
 * three separators where it expected four reads the editable mask as the
 * message.
 *
 * ## The editable mask
 *
 * A bitmask over which fields the payer is allowed to change: number `0b001`,
 * amount `0b010`, message `0b100`. This writes **0** — nothing editable. The
 * amount on the code is the amount the balances say is owed, and a payer who
 * edits it has not settled the debt the row is about, so the app would show it
 * as still open. Locking it is what makes the code and the ledger agree.
 *
 * ## Kronor, or no code
 *
 * Swish settles in SEK and the format carries no currency at all — the number
 * after the first semicolon is kronor by definition. So a debt in euros gets
 * no code, on exactly the rule the EPC and Pix builders follow: a figure in
 * the wrong currency is worse than no figure.
 *
 * Source: *Guide Swish QR code design specification*, v1.7.2. Checked August
 * 2026. The amount is written as a plain decimal with a dot, which is what the
 * specification's own examples show — but see `docs/settling-up.md`: no code
 * from this file has yet been scanned by a real Swish app.
 */

export interface SwishQrInput {
  /** The payee's Swish number, as stored: E.164, so `+46701234567`. */
  readonly phone: string;
  readonly minorUnits: string;
  readonly currency: string;
  /** What the payment is for. Shown in the payer's Swish message field. */
  readonly message: string;
}

/** Swish's own limit on the message a payment carries. */
const MAX_MESSAGE = 50;

/** Nothing editable: the figure on the code is the figure that is owed. */
const LOCKED = "0";

export function buildSwishQrPayload(input: SwishQrInput): string | null {
  if (input.currency.toUpperCase() !== "SEK") return null;

  const number = swishNumber(input.phone);
  if (!number) return null;

  const amount = toMajorString(money(BigInt(input.minorUnits), "SEK"));
  if (amount.startsWith("-") || amount === "0.00") return null;

  return `C${number};${amount};${message(input.message)};${LOCKED}`;
}

/**
 * The number as the code carries it: digits only, country code kept.
 *
 * Stored details are E.164 because that is the only form somebody abroad can
 * use, and this format wants the same number without its plus. `+46701234567`
 * becomes `46701234567`, which is what the Swish app registers a Swedish
 * mobile as.
 *
 * A non-Swedish number gets no code. Swish is domestic to Sweden, and a code
 * built around a French mobile would scan into an app that cannot pay it.
 */
function swishNumber(phone: string): string | null {
  const digits = phone.replace(/[\s.\-()]/g, "").replace(/^\+/, "");
  if (!/^46\d{7,13}$/.test(digits)) return null;
  return digits;
}

/**
 * The message, with the two characters that would change the shape removed.
 *
 * A semicolon in a group name would add a field; a newline would end the
 * payload. Neither is worth refusing a code over — a group called "Rome; 2026"
 * is a perfectly ordinary group — so both become spaces and the code is built.
 */
function message(value: string): string {
  return value
    .replace(/[;\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE)
    .trim();
}
