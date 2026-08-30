import { payoutFieldFor } from "../fields";
import { buildEpcQrPayload } from "./epc";
import { buildPixQrPayload } from "./pix";
import { buildSpaydQrPayload } from "./spayd";
import { buildSwishQrPayload } from "./swish";
import {
  buildSwissQrPayload,
  isQrIban,
  type SwissCreditorAddress,
} from "./swiss";
import { buildZbpQrPayload } from "./zbp";

/**
 * Which payment code to offer, if any.
 *
 * There is no best standard here and no preference to express: a Swiss banking
 * app reads the Swiss QR-bill and not the Girocode, a Czech one reads SPAYD, a
 * Brazilian one reads a BR Code. So the choice is made by *what is being paid
 * into* — the method, and for a bank transfer the country of the IBAN and the
 * currency of the debt — and never by what this application would rather emit.
 *
 * ## Why the list grew past the two SEPA standards
 *
 * The Girocode's amount element is defined as EUR. That one line in EPC069-12
 * left every non-euro country inside SEPA with a bank transfer and no code:
 * Poland, Czechia, Sweden, Denmark, Hungary, Romania. The national formats
 * were not added for completeness — they are the only way those payments get a
 * code at all, and two of them are countries whose language this application
 * already ships.
 *
 * A second gap closed at the same time: a code is no longer only ever built
 * from a bank transfer. Pix and Swish are the two schemes in the catalogue
 * whose own artefact a third party can construct — a Pix key and a Swedish
 * mobile number are all either one needs — and both were previously offered as
 * a payout method that produced nothing but a string to retype.
 *
 * ## Returning null is a real answer, and the common one
 *
 * A Swiss account with no address on file, a QR-IBAN, a debt in a currency the
 * standard cannot carry — each of those is a code that cannot be built
 * correctly, and a code that cannot be built correctly must not be built at
 * all. What people do with a payment code is trust it.
 */

export type PaymentQrStandard =
  "swiss" | "epc" | "pix" | "swish" | "spayd" | "zbp";

export interface PaymentQrRequest {
  /** Which of the payee's methods this code would pay into. */
  readonly method: string;
  /** That method's stored detail: an IBAN, a Pix key, a mobile number. */
  readonly detail: string;
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
  if (input.detail.trim() === "") return null;

  switch (input.method) {
    case "pix": {
      const payload = buildPixQrPayload({
        key: input.detail,
        creditorName: input.creditorName,
        city: input.address?.town ?? null,
        minorUnits: input.minorUnits,
        currency: input.currency,
      });
      return payload ? { standard: "pix", payload } : null;
    }

    case "swish": {
      const payload = buildSwishQrPayload({
        phone: input.detail,
        minorUnits: input.minorUnits,
        currency: input.currency,
        message: input.message,
      });
      return payload ? { standard: "swish", payload } : null;
    }

    default:
      // Every remaining code is built from an account number, so the methods
      // that have one are exactly the methods that can have a code — which
      // `payoutFieldFor` already knows, and which is why a second list of
      // bank-like methods is not kept here to fall out of step with it.
      return payoutFieldFor(input.method) === "iban" ? fromIban(input) : null;
  }
}

/**
 * The code for a transfer into an account, chosen by where the account is.
 *
 * The order is not arbitrary. A domestic standard wins over the Girocode
 * wherever both could apply, because the domestic one carries the currency the
 * debt is actually in — and the Girocode, being euros only, would otherwise
 * refuse and leave the payer with nothing.
 */
function fromIban(input: PaymentQrRequest): PaymentQr | null {
  const iban = input.detail.replace(/\s/g, "").toUpperCase();
  const currency = input.currency.toUpperCase();

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

  if (iban.startsWith("CZ") && currency === "CZK") {
    const payload = buildSpaydQrPayload({
      iban,
      creditorName: input.creditorName,
      minorUnits: input.minorUnits,
      currency,
      message: input.message,
    });
    return payload ? { standard: "spayd", payload } : null;
  }

  if (iban.startsWith("PL") && currency === "PLN") {
    const payload = buildZbpQrPayload({
      iban,
      creditorName: input.creditorName,
      minorUnits: input.minorUnits,
      currency,
      message: input.message,
    });
    return payload ? { standard: "zbp", payload } : null;
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
  const currency = input.currency.toUpperCase();

  // The two schemes that settle in one currency and carry no rate. Nothing
  // else about them can fail in a way the reader could do something about.
  if (input.method === "pix") return currency === "BRL" ? "none" : "currency";
  if (input.method === "swish") return currency === "SEK" ? "none" : "currency";
  if (payoutFieldFor(input.method) !== "iban") return "none";

  const iban = input.detail.replace(/\s/g, "").toUpperCase();

  if (/^(CH|LI)/.test(iban)) {
    if (isQrIban(iban)) return "qrIban";
    if (!input.address) return "addressMissing";
    if (currency !== "CHF" && currency !== "EUR") return "currency";
    return "none";
  }

  // A domestic standard covers this account's own currency, so the euro rule
  // only bites where neither it nor the Girocode applies.
  if (iban.startsWith("CZ") && currency === "CZK") return "none";
  if (iban.startsWith("PL") && currency === "PLN") return "none";

  return currency === "EUR" ? "none" : "currency";
}
