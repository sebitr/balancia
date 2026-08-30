/**
 * EMV® QR Code Specification for Payment Systems — merchant-presented mode.
 *
 * The substrate under a whole tier of national payment codes. Pix in Brazil,
 * PayNow in Singapore, PromptPay in Thailand, DuitNow in Malaysia, QRIS in
 * Indonesia and UPI's own QR are all the same encoding with a different
 * domestic template inside it — so this file knows the container and nothing
 * about any one scheme, and each scheme brings its own template.
 *
 * The encoding is as small as encodings get: a flat sequence of
 * `IDLLVALUE` — a two-digit identifier, a two-digit length, then exactly that
 * many characters. A template is the same thing again, nested inside a value,
 * which is how a scheme gets to define its own fields without a registry.
 *
 * Its three traps, all of which have cost somebody a payment:
 *
 *  1. **The length is characters, not bytes** — and readers disagree about
 *     what a character is once the value stops being ASCII. Nothing here
 *     resolves that argument; it refuses instead, and the schemes above all
 *     require an ASCII name anyway. See `isAscii`.
 *  2. **The CRC covers its own identifier and length.** `6304` is written
 *     first and the checksum computed over the string *including* those four
 *     characters. Computing it over the payload without them is the classic
 *     mistake, and it produces a code that scans and then fails.
 *  3. **Order is not free.** The CRC must be last because it is defined over
 *     everything before it; the rest is written in ascending identifier order
 *     because that is what the specification shows and what readers with a
 *     hand-rolled parser expect.
 */

export interface EmvcoField {
  /** Two digits. The specification calls this the identifier. */
  readonly id: string;
  readonly value: string;
}

/** The identifier the checksum always occupies, by definition. */
const CRC_ID = "63";

/** A value is `LL` characters long, and `LL` is two digits. */
const MAX_VALUE_LENGTH = 99;

/**
 * One field, or null when it cannot be written correctly.
 *
 * An over-long value is a refusal rather than a truncation. Truncating a name
 * is cosmetic; truncating an account identifier pays a stranger.
 */
export function emvcoField(id: string, value: string): string | null {
  if (!/^\d{2}$/.test(id)) return null;
  if (!isAscii(value)) return null;
  if (value.length === 0 || value.length > MAX_VALUE_LENGTH) return null;
  return `${id}${String(value.length).padStart(2, "0")}${value}`;
}

/**
 * A template: fields nested inside one field's value.
 *
 * Returns null when any child does, because a template missing a child is not
 * a smaller template — it is a different one, and the scheme that defined it
 * said which children it needs.
 */
export function emvcoTemplate(
  id: string,
  children: readonly EmvcoField[],
): string | null {
  const parts: string[] = [];
  for (const child of children) {
    const encoded = emvcoField(child.id, child.value);
    if (encoded === null) return null;
    parts.push(encoded);
  }
  return emvcoField(id, parts.join(""));
}

/**
 * The whole payload, with the checksum appended.
 *
 * Fields arrive already encoded — a caller that built a template has a string
 * rather than an id and a value, and re-splitting it here to put it back
 * together would be a parser this file does not need to have.
 *
 * A null anywhere in the list propagates: it means a field the scheme required
 * could not be written, and a payment code missing a required field is exactly
 * the thing this returns null to prevent.
 */
export function buildEmvcoPayload(
  fields: readonly (string | null)[],
): string | null {
  const parts: string[] = [];
  for (const field of fields) {
    if (field === null) return null;
    parts.push(field);
  }
  if (parts.length === 0) return null;

  // The identifier and the length of the checksum are inside the checksum.
  const body = `${parts.join("")}${CRC_ID}04`;
  return `${body}${crc16CcittFalse(body)}`;
}

/**
 * CRC-16/CCITT-FALSE: polynomial 0x1021, initial value 0xFFFF, no reflection
 * of input or output, no final XOR.
 *
 * Named in full because "CRC-16" alone names about eight different functions,
 * and the one EMVCo specifies is the one that is *not* the reflected variant
 * most libraries ship as their default. Four uppercase hex digits, which the
 * specification is explicit about — a lowercase checksum is rejected by
 * readers that compare the string rather than the number.
 */
export function crc16CcittFalse(input: string): string {
  let crc = 0xffff;
  for (let index = 0; index < input.length; index += 1) {
    crc ^= input.charCodeAt(index) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/**
 * Whether a value is safe to measure in characters.
 *
 * The length prefix is defined in characters and read by parsers that count
 * bytes, so the two must be the same number or a reader walks off the end of
 * one field and into the middle of the next. Restricting to ASCII is what
 * makes them the same number, and every scheme built on this container asks
 * for an ASCII name regardless — `asciiFold` is how a name gets here.
 */
function isAscii(value: string): boolean {
  // Printable ASCII: space through tilde. Control characters are excluded for
  // the same reason as everything above 0x7e — a reader counting bytes and a
  // length counting characters have to agree, and a newline in a payload that
  // is one line by definition is not a value anybody meant to write.
  return /^[ -~]*$/.test(value);
}

/**
 * A name as these codes can carry it: accents removed, not replaced by
 * question marks.
 *
 * "Léa Martin" becomes "Lea Martin" rather than "L?a Martin" or a refusal.
 * Decomposing to NFD splits the accent into its own combining character, which
 * the range below then drops — so this handles every Latin accent without a
 * table, and leaves anything genuinely outside Latin to be caught by the ASCII
 * check rather than mangled into nonsense.
 */
export function asciiFold(value: string): string {
  return (
    value
      .normalize("NFD")
      // The combining marks NFD just split off, by codepoint rather than as
      // literal characters — invisible glyphs in a character class are how a
      // later edit silently deletes one.
      .replace(/[̀-ͯ]/g, "")
      .replace(/[ØøŁłÆæßÐðÞþ]/g, (character) => STROKED[character] ?? character)
      .replace(/\s+/g, " ")
      .trim()
  );
}

/**
 * The letters a decomposition cannot reach.
 *
 * NFD splits a letter from its accent, which is why the range above handles
 * every acute, grave and umlaut without a table. These are not accented
 * letters — the stroke is part of the glyph, and ß and þ are not Latin letters
 * with marks on them at all — so they decompose to themselves and need saying.
 */
const STROKED: Readonly<Record<string, string>> = {
  Ø: "O",
  ø: "o",
  Ł: "L",
  ł: "l",
  Æ: "AE",
  æ: "ae",
  ß: "ss",
  Ð: "D",
  ð: "d",
  Þ: "TH",
  þ: "th",
};

/**
 * The amount as these codes want it: a dot, no separators, and no more places
 * than the currency has.
 *
 * Trailing zeros are kept rather than trimmed. The specification permits
 * either, and every reference payload in every one of these schemes writes
 * "10.00" — a code that differs from the reference in a way the specification
 * allows is still a code somebody will report as broken.
 */
export function emvcoAmount(minorUnits: string, exponent: number): string {
  const negative = minorUnits.startsWith("-");
  const digits = (negative ? minorUnits.slice(1) : minorUnits).padStart(
    exponent + 1,
    "0",
  );
  if (exponent === 0) return digits;
  const whole = digits.slice(0, digits.length - exponent);
  const fraction = digits.slice(digits.length - exponent);
  return `${whole}.${fraction}`;
}
