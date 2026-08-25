/**
 * The EPC QR code — "Girocode" — for a SEPA credit transfer.
 *
 * EPC069-12 v3.1 (European Payments Council, March 2024). Eleven lines,
 * newline-separated, and the last populated one carries no trailing separator.
 *
 * What it needs is far less than the Swiss code: a name and an IBAN. There is
 * no address in it at all, which is why this one can be built from what an
 * account already has.
 *
 * Its own three traps:
 *
 *  1. **Euros only.** The amount element is defined as EUR, so a debt in any
 *     other currency cannot carry one. A code with no amount would still be
 *     valid — but it would ask somebody to type the number themselves, which
 *     is the mistake the code exists to prevent, so this refuses instead.
 *  2. **331 bytes.** Counted in bytes rather than characters, so an accented
 *     name costs more than its length suggests.
 *  3. **One remittance, not two.** A structured creditor reference and an
 *     unstructured text are mutually exclusive; sending both is what makes a
 *     reader pick one arbitrarily.
 */

export interface EpcQrInput {
  readonly iban: string;
  readonly creditorName: string;
  /** Minor units. EUR only, and two decimals. */
  readonly minorUnits?: string | null;
  readonly currency: string;
  /** Free text shown to the payer. Mutually exclusive with `reference`. */
  readonly remittance?: string | null;
  /** ISO 11649 creditor reference, if there ever is one. */
  readonly reference?: string | null;
  /** Optional since version 002; kept for the readers that still want it. */
  readonly bic?: string | null;
}

const MAX = { name: 70, remittance: 140, reference: 35, bytes: 331 } as const;

export function buildEpcQrPayload(input: EpcQrInput): string | null {
  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return null;

  const name = clean(input.creditorName, MAX.name);
  if (!name) return null;

  const amount = formatAmount(input.minorUnits, input.currency);
  if (amount === null) return null;

  // Both would be a reader's guess as to which one mattered.
  const reference = clean(input.reference, MAX.reference);
  const remittance = reference ? "" : clean(input.remittance, MAX.remittance);

  const lines = [
    "BCD", // 1 Service tag
    // 2 Version. 002 is what makes the BIC optional, which matters because a
    // shared-expense app knows an IBAN and has no business deriving a BIC.
    "002",
    "1", // 3 Character set: UTF-8
    "SCT", // 4 Identification: SEPA Credit Transfer
    clean(input.bic, 11), // 5 optional in version 002
    name, // 6
    iban, // 7
    amount, // 8
    "", // 9 Purpose: an ISO 20022 code, and none of them says "dinner"
    reference, // 10
    remittance, // 11
  ];

  // "The last populated element is not followed by any character or element
  // separator" — so the trailing empty lines come off rather than being sent.
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const payload = lines.join("\n");
  return byteLength(payload) <= MAX.bytes ? payload : null;
}

/** EUR, with a dot, and no thousands separator: `EUR84.20`. */
function formatAmount(
  minorUnits: string | null | undefined,
  currency: string,
): string | null {
  if (minorUnits === null || minorUnits === undefined || minorUnits === "") {
    return "";
  }
  if (currency !== "EUR") return null;

  let value: bigint;
  try {
    value = BigInt(minorUnits);
  } catch {
    return null;
  }
  // The guidelines put the range at 0.01 to 999999999.99.
  if (value < 1n || value > 99_999_999_999n) return null;

  const whole = value / 100n;
  const cents = (value % 100n).toString().padStart(2, "0");
  return `EUR${whole}.${cents}`;
}

function clean(value: string | null | undefined, max: number): string {
  return (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}
