import { money, toMajorString } from "@/modules/currencies/money";
import { asciiFold } from "./emvco";

/**
 * SPAYD — the Short Payment Descriptor, which is what a Czech banking app
 * scans.
 *
 * It exists here for one reason: **the Girocode is euros only.** EPC069-12
 * defines its amount element as EUR, so every non-euro country inside SEPA —
 * Czechia, Poland, Sweden, Denmark, Hungary, Romania — currently gets a bank
 * transfer with no code at all, however ordinary the payment is. The national
 * standards are the answer to that, and this is the simplest of them.
 *
 * The format is a header and then `KEY:value` pairs, all separated by
 * asterisks:
 *
 *     SPD*1.0*ACC:CZ2806000000000168540115*AM:450.00*CC:CZK*MSG:Vecere
 *
 * `ACC` comes first by convention and everything after it is order-independent
 * in practice, though readers in the wild are happier with the order the
 * specification prints, which is what this writes.
 *
 * ## Its one structural trap
 *
 * The asterisk is the separator and has no escape that readers agree on. A
 * message containing one would silently become two fields, and the second
 * would be read as an unknown key and dropped — so asterisks are removed from
 * the message rather than escaped, and the code is still built. Losing a
 * punctuation mark from "Rome *2026*" costs nothing; losing the amount after
 * it costs a payment.
 *
 * ## Koruny, and only koruny
 *
 * Not because SPAYD says so — `CC` carries any ISO code — but because a Czech
 * account paid in euros already has a Girocode, and two codes for one debt is
 * a choice the payer should not have to make. This fills the gap the Girocode
 * leaves rather than competing with it.
 *
 * Source: the SPAYD specification, version 1.0. Checked August 2026.
 */

export interface SpaydQrInput {
  readonly iban: string;
  readonly creditorName: string;
  readonly minorUnits: string;
  readonly currency: string;
  readonly message: string;
}

const MAX = { name: 35, message: 60 } as const;

export function buildSpaydQrPayload(input: SpaydQrInput): string | null {
  if (input.currency.toUpperCase() !== "CZK") return null;

  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!/^CZ\d{2}[A-Z0-9]{10,30}$/.test(iban)) return null;

  const amount = toMajorString(money(BigInt(input.minorUnits), "CZK"));
  if (amount.startsWith("-") || amount === "0.00") return null;

  const name = clean(input.creditorName, MAX.name);
  const message = clean(input.message, MAX.message);

  const fields = [
    `ACC:${iban}`,
    `AM:${amount}`,
    "CC:CZK",
    name ? `RN:${name}` : "",
    message ? `MSG:${message}` : "",
  ].filter((field) => field !== "");

  return `SPD*1.0*${fields.join("*")}`;
}

/**
 * A value the format can carry: folded to ASCII, stripped of its separator and
 * cut to length.
 *
 * The fold is not cosmetic. SPAYD's character set is ASCII, and a reader that
 * meets "Večeře" either drops the payload or renders it as noise — neither of
 * which tells the payer what they are paying for, while "Vecere" does.
 */
function clean(value: string, max: number): string {
  return asciiFold(value)
    .replace(/[*\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
