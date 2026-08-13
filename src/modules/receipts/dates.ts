/**
 * Reading the date off a receipt.
 *
 * Receipts print dates in every order humans have invented, and the ambiguous
 * ones are genuinely ambiguous: `05/08/2026` is 5 August in Zurich and 8 May in
 * Boston, and nothing on the paper resolves it. Balancia reads day-first, which
 * is what the overwhelming majority of receipts its users photograph will be,
 * and the review screen puts the date in an editable field precisely because
 * this call can be wrong.
 *
 * Where the receipt is unambiguous — a day above 12, a month name, an ISO date
 * — that reading always wins over the default.
 */

/** Month names and their common abbreviations, accent-folded. */
const MONTH_NAMES: Readonly<Record<string, number>> = {
  // en
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
  // fr
  janv: 1,
  janvier: 1,
  fevr: 2,
  fevrier: 2,
  mars: 3,
  avr: 4,
  avril: 4,
  mai: 5,
  juin: 6,
  juil: 7,
  juillet: 7,
  aout: 8,
  septembre: 9,
  octobre: 10,
  novembre: 11,
  dec_: 12,
  decembre: 12,
  // de
  marz: 3,
  maerz: 3,
  mrz: 3,
  okt: 10,
  oktober: 10,
  dez: 12,
  dezember: 12,
  januar: 1,
  februar: 2,
  juni: 6,
  juli: 7,
  // it
  gen: 1,
  gennaio: 1,
  febbraio: 2,
  marzo: 3,
  aprile: 4,
  mag: 5,
  maggio: 5,
  giu: 6,
  giugno: 6,
  lug: 7,
  luglio: 7,
  ago: 8,
  agosto: 8,
  set: 9,
  settembre: 9,
  ott: 10,
  ottobre: 10,
  novembre_: 11,
  dic: 12,
  dicembre: 12,
  // es
  ene: 1,
  enero: 1,
  febrero: 2,
  abr: 4,
  abril: 4,
  mayo: 5,
  junio: 6,
  julio: 7,
  agosto_: 8,
  septiembre: 9,
  octubre: 10,
  noviembre: 11,
  diciembre: 12,
};

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** `26` → 2026, `98` → 1998. Receipts do not predate the pivot in practice. */
function expandYear(value: number): number {
  if (value >= 100) return value;
  return value < 70 ? 2000 + value : 1900 + value;
}

function isRealDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  if (year < 1970 || year > 2999) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

function iso(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** `2026-08-13`, unambiguous everywhere. */
const ISO_PATTERN = /(?<![\d])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d])/;

/** `13.08.2026`, `13/08/26`, `13-8-2026`. */
const NUMERIC_PATTERN =
  /(?<![\d])(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?![\d])/;

/** `13 Aug 2026`, `13. August 2026`, `13 aout 26`. */
const DAY_MONTH_NAME =
  /(?<![\d])(\d{1,2})\.?\s+([\p{L}]{3,12})\.?,?\s+(\d{2,4})(?![\d])/u;

/** `Aug 13, 2026`, `August 13 2026`. */
const MONTH_NAME_DAY =
  /([\p{L}]{3,12})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{2,4})(?![\d])/u;

/**
 * Puts back the space between a date and a time that OCR ran together.
 *
 * Receipts print `13.08.2026 20:14` in a thin, often single, column, and the
 * recognizer regularly returns `13.08.202620:14`. Every date pattern here
 * requires the year not to be followed by another digit — otherwise
 * `13.08.20262` would be read as a year — so without this the date is simply
 * lost, which is exactly what happened on the first real browser run.
 *
 * The rule is narrow on purpose: a full four-digit year immediately followed by
 * something shaped like a clock time. Anchoring on four digits is what makes
 * the split land in the right place — matching "any digit" lets the hour run
 * greedily backwards into the year, turning `2026` `20:14` into `202` `69:05`.
 */
function separateGluedTime(text: string): string {
  return text.replace(/(\d{4})(\d{1,2}:\d{2})/g, "$1 $2");
}

/**
 * Finds a date in a line of receipt text, as `YYYY-MM-DD`, or `null`.
 *
 * Reads day-first for ambiguous numeric dates; see the module note.
 */
export function parseReceiptDate(input: string): string | null {
  const text = separateGluedTime(input);
  const isoMatch = ISO_PATTERN.exec(text);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    const year = Number(y);
    const month = Number(m);
    const day = Number(d);
    if (isRealDate(year, month, day)) return iso(year, month, day);
  }

  const named = DAY_MONTH_NAME.exec(text);
  if (named) {
    const [, d, name, y] = named;
    const month = MONTH_NAMES[fold(name)];
    const year = expandYear(Number(y));
    const day = Number(d);
    if (month && isRealDate(year, month, day)) return iso(year, month, day);
  }

  const namedFirst = MONTH_NAME_DAY.exec(text);
  if (namedFirst) {
    const [, name, d, y] = namedFirst;
    const month = MONTH_NAMES[fold(name)];
    const year = expandYear(Number(y));
    const day = Number(d);
    if (month && isRealDate(year, month, day)) return iso(year, month, day);
  }

  const numeric = NUMERIC_PATTERN.exec(text);
  if (numeric) {
    const [, first, second, third] = numeric;
    const a = Number(first);
    const b = Number(second);
    const year = expandYear(Number(third));

    // A value above 12 can only be a day, whichever position it is in. That
    // settles most receipts without falling back to the default.
    if (a > 12 && b <= 12 && isRealDate(year, b, a)) return iso(year, b, a);
    if (b > 12 && a <= 12 && isRealDate(year, a, b)) return iso(year, a, b);
    // Ambiguous: day first.
    if (isRealDate(year, b, a)) return iso(year, b, a);
    if (isRealDate(year, a, b)) return iso(year, a, b);
  }

  return null;
}
