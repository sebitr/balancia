import { asciiFold } from "./emvco";

/**
 * The Polish two-dimensional code, as recommended by the Związek Banków
 * Polskich.
 *
 * The other half of the answer to the Girocode's euro-only amount — see
 * `spayd.ts` for the same argument made about Czechia. Poland is the case that
 * matters most to this application today, because it is the one non-euro
 * country whose language it already ships.
 *
 * Eight fields, pipe-separated, no header and no checksum:
 *
 *     |PL|12345678901234567890123456|008350|Lea Martin|Rzym 2026||
 *
 * The first field is the recipient's tax identifier, which a person does not
 * have and which is therefore empty — as are the last two, which the
 * recommendation reserves and does not define.
 *
 * ## The one field that is a gift
 *
 * The amount is **in grosz**, written as digits with no decimal point at all.
 * That is exactly how this application already stores money, so the field is
 * the stored value and no conversion happens on the way in — the one place in
 * this directory where nothing can be lost in formatting, because nothing is
 * formatted.
 *
 * ## The account is not the IBAN
 *
 * The field takes the 26-digit NRB, which is the Polish IBAN with its `PL` and
 * check digits removed. Writing the full IBAN there is the mistake this format
 * invites, and it produces a code that scans into a rejected transfer.
 *
 * Złoty only: the format carries no currency, so the amount is grosz by
 * definition and a debt in anything else gets no code.
 *
 * Source: ZBP, *Rekomendacja dotycząca kodu dwuwymiarowego*. Checked August
 * 2026.
 */

export interface ZbpQrInput {
  readonly iban: string;
  readonly creditorName: string;
  readonly minorUnits: string;
  readonly currency: string;
  readonly message: string;
}

const MAX = { name: 20, title: 32, amount: 6 } as const;

export function buildZbpQrPayload(input: ZbpQrInput): string | null {
  if (input.currency.toUpperCase() !== "PLN") return null;

  const iban = input.iban.replace(/\s/g, "").toUpperCase();
  if (!/^PL\d{26}$/.test(iban)) return null;
  /*
   * The NRB: everything after the country code, check digits included.
   *
   * This is the subtle half of the trap. Poland's NRB is 26 digits and its
   * IBAN is 28 characters, so the two check digits belong to *both* — they are
   * the front of the NRB and they sit behind the `PL`. Dropping them along
   * with the country code, which is what removing an IBAN's four-character
   * prefix usually means, leaves 24 digits that are still all digits, still
   * look like an account, and are not one.
   */
  const account = iban.slice(2);

  const grosz = BigInt(input.minorUnits);
  if (grosz <= 0n) return null;
  const amount = grosz.toString().padStart(MAX.amount, "0");
  // Six digits is the field's width, so anything from ten thousand złoty up
  // cannot be written. A code that dropped the leading digit would ask for a
  // tenth of the debt and look entirely reasonable doing it.
  if (amount.length > MAX.amount) return null;

  const name = clean(input.creditorName, MAX.name);
  const title = clean(input.message, MAX.title);

  return ["", "PL", account, amount, name, title, "", ""].join("|");
}

/**
 * A value with the separator taken out, folded to ASCII and cut.
 *
 * A pipe inside a group name would add a field and shift every field after it
 * by one — which, in a format with no keys and no checksum, means the title
 * would be read as the reserved field and the amount would still parse. Silent
 * and wrong is the worst failure available here, so the character goes.
 */
function clean(value: string, max: number): string {
  return asciiFold(value)
    .replace(/[|\r\n]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}
