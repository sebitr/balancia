/**
 * "Nov 25", spelled the same by every ICU build.
 *
 * Recent CLDR data writes a two-digit year with an apostrophe ("Nov ’25"), and
 * older data, the sort a server's Node and a reader's browser can differ on,
 * does not. Rendered on both sides that is a hydration mismatch, so the
 * literal pieces between the month and the year are rebuilt here: the month
 * and the year still come from `Intl`, in the reader's order, and an
 * apostrophe never survives.
 */
export function shortMonthWithYear(
  formatLocale: string,
): (date: Date) => string {
  const format = new Intl.DateTimeFormat(formatLocale, {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  });
  return (date) =>
    format
      .formatToParts(date)
      .map((part) =>
        part.type === "literal" ? part.value.replace(/['’ʼ]/g, "") : part.value,
      )
      .join("")
      .replace(/\s+/g, " ")
      .trim();
}
