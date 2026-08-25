import { buildEpcQrPayload } from "./epc";
import {
  buildSwissQrPayload,
  isQrIban,
  type SwissCreditorAddress,
} from "./swiss";

/**
 * Which payment code to offer, if either.
 *
 * The two standards do not overlap and do not compete: a Swiss banking app
 * reads the Swiss QR-bill and not the Girocode, and the rest of SEPA the other
 * way round. So this is decided by the account, not by preference — the IBAN's
 * country says which scheme the creditor's bank is in.
 *
 * Returning null is a real answer and the common one. A Swiss account with no
 * address on file, a QR-IBAN, a debt in a currency neither standard carries —
 * each of those is a code that cannot be built correctly, and a code that
 * cannot be built correctly must not be built at all. What people do with a
 * payment QR is trust it.
 */

export type PaymentQrStandard = "swiss" | "epc";

export interface PaymentQrRequest {
  readonly iban: string;
  readonly creditorName: string;
  /** Null when the creditor has never been asked for one. */
  readonly address: SwissCreditorAddress | null;
  readonly minorUnits: string;
  readonly currency: string;
  /** What the payment is for, in the payer's own language. */
  readonly message: string;
}

export interface PaymentQr {
  readonly standard: PaymentQrStandard;
  readonly payload: string;
}

export function buildPaymentQr(input: PaymentQrRequest): PaymentQr | null {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();

  if (/^(CH|LI)/.test(iban)) {
    // A Swiss account can only ever be served by the Swiss standard: its bank
    // does not read a Girocode, so falling back to one would produce a code
    // that scans into nothing.
    if (!input.address || isQrIban(iban)) return null;
    const payload = buildSwissQrPayload({
      iban,
      creditorName: input.creditorName,
      address: input.address,
      minorUnits: input.minorUnits,
      currency: input.currency,
      message: input.message,
    });
    return payload ? { standard: "swiss", payload } : null;
  }

  const payload = buildEpcQrPayload({
    iban,
    creditorName: input.creditorName,
    minorUnits: input.minorUnits,
    currency: input.currency,
    remittance: input.message,
  });
  return payload ? { standard: "epc", payload } : null;
}

/**
 * Why there is no code, for the screens that would rather say than show
 * nothing.
 *
 * Only the reason a person can act on is named. "This IBAN is a QR-IBAN" is
 * true and useless; "your bank issues invoice references we cannot generate"
 * is the same fact told to somebody who might otherwise think it a bug.
 */
export type PaymentQrRefusal =
  "addressMissing" | "qrIban" | "currency" | "none";

export function explainMissingQr(input: PaymentQrRequest): PaymentQrRefusal {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (/^(CH|LI)/.test(iban)) {
    if (isQrIban(iban)) return "qrIban";
    if (!input.address) return "addressMissing";
    if (input.currency !== "CHF" && input.currency !== "EUR") return "currency";
    return "none";
  }
  return input.currency === "EUR" ? "none" : "currency";
}
