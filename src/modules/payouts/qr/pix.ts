import {
  asciiFold,
  buildEmvcoPayload,
  emvcoAmount,
  emvcoField,
  emvcoTemplate,
} from "./emvco";

/**
 * The Pix BR Code — the Central Bank of Brazil's instantiation of EMV®
 * QRCPS-MPM.
 *
 * The same string does two jobs, which is why this returns text rather than a
 * matrix: drawn as a QR code it is scanned, and copied as text it is what
 * every Brazilian banking app calls **Pix Copia e Cola**. Pasting is not a
 * lesser path here — for a great many people it is the usual one.
 *
 * It needs nothing from a server. A static BR Code is assembled from the
 * payee's Pix key and the amount, and that is the whole of it. The key is
 * already what `payoutFieldFor` stores for the method.
 *
 * ## Why the name and the city matter less than they look
 *
 * Fields 59 and 60 are mandatory in the specification and are *not* how the
 * payment is routed. The payer's bank resolves the key against the Pix
 * directory and shows the holder's real, legal name — so what is written here
 * is informational, and cannot redirect money to the wrong person.
 *
 * That is why a missing city is a placeholder rather than a refusal, which is
 * the opposite of the call the Swiss QR-bill makes a few files away. There the
 * address is validated by the creditor's bank and a wrong one is rejected at
 * the counter; here it is a label. The rule is the same in both places — never
 * write a field that could misdirect a payment — and it lands differently
 * because the field does something different.
 *
 * ## Brazilian reais, or no code
 *
 * Field 53 is the transaction currency and a Pix payment is settled in BRL;
 * there is no exchange in the scheme. A code carrying "83.34" for a debt in
 * euros would be the single worst thing this feature could do, so a non-BRL
 * debt gets no code at all. A valueless BR Code would be valid and is
 * deliberately not built: the key is already on screen and copyable, so a code
 * that omits the amount adds nothing the row did not already have.
 *
 * Source: Banco Central do Brasil, *Manual de Padrões para Iniciação do Pix*
 * (BR Code), which instantiates EMV® QRCPS-MPM v1.1. Checked August 2026.
 */

export interface PixQrInput {
  /** The payee's Pix key: CPF, CNPJ, email, phone or a random EVP. */
  readonly key: string;
  readonly creditorName: string;
  /** The payee's town, when one is on file. A placeholder stands in. */
  readonly city?: string | null;
  readonly minorUnits: string;
  readonly currency: string;
}

const MAX = { key: 77, name: 25, city: 15 } as const;

/**
 * What stands in for a town nobody has been asked for.
 *
 * Portuguese, because the field is read inside Brazilian banking apps, and
 * literally "not informed" — which is true, unlike the São Paulo that several
 * public generators write into every code they produce.
 */
const CITY_UNKNOWN = "NAO INFORMADO";

/** Pix is settled in reais and carries no rate. */
const CURRENCY = { code: "BRL", numeric: "986", exponent: 2 } as const;

export function buildPixQrPayload(input: PixQrInput): string | null {
  if (input.currency.toUpperCase() !== CURRENCY.code) return null;

  // A debt of nothing is not a payment, and a negative one is somebody else's
  // debt written backwards — `emvcoAmount` would drop the sign and ask for it
  // as though it were owed this way round.
  const owed = BigInt(input.minorUnits);
  if (owed <= 0n) return null;

  const key = input.key.trim();
  if (key.length === 0 || key.length > MAX.key) return null;
  // A key is one of five shapes and every one of them is ASCII. Anything else
  // is not a key that was typed wrong, it is a different thing in the field.
  if (asciiFold(key) !== key) return null;

  const name = clip(asciiFold(input.creditorName), MAX.name);
  if (!name) return null;

  const city = clip(asciiFold(input.city ?? ""), MAX.city) || CITY_UNKNOWN;

  return buildEmvcoPayload([
    // 00 — payload format indicator, which has only ever had one value.
    emvcoField("00", "01"),
    // 01 — static. "Dynamic" in this scheme means the payload is fetched from
    // a URL at scan time, which is a merchant arrangement and not this.
    emvcoField("01", "11"),
    // 26 — the Pix template. The globally unique identifier is a fixed string
    // and the key follows it; nothing else belongs in here. An optional
    // description is permitted and omitted, because the template must fit in
    // 99 characters and a 77-character key already spends all but one of them.
    emvcoTemplate("26", [
      { id: "00", value: "br.gov.bcb.pix" },
      { id: "01", value: key },
    ]),
    // 52 — merchant category. Four zeros is the code for "none of these", and
    // a person splitting a dinner is not a merchant category.
    emvcoField("52", "0000"),
    emvcoField("53", CURRENCY.numeric),
    emvcoField("54", emvcoAmount(input.minorUnits, CURRENCY.exponent)),
    emvcoField("58", "BR"),
    emvcoField("59", name),
    emvcoField("60", city),
    // 62 — additional data. Field 05 is the reference the payer's statement
    // shows; three asterisks is the specification's own way of saying there is
    // none, and is what a static code without an invoice behind it carries.
    emvcoTemplate("62", [{ id: "05", value: "***" }]),
  ]);
}

/**
 * Trimmed and cut to what the field can hold.
 *
 * A name is the one thing here that is cut rather than refused: it is a label
 * the payer reads beside the real name their own bank resolves, so losing its
 * tail costs nothing, while refusing over it would cost the whole code.
 */
function clip(value: string, max: number): string {
  return value.trim().slice(0, max).trim();
}
