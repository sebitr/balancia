/**
 * Date helpers shared by the server and the browser.
 *
 * Expense and settlement dates are stored as plain calendar days
 * ("2026-08-13") with no time and no zone — the day someone spent the money,
 * not an instant. Handing that string to `new Date()` parses it as UTC
 * midnight, which is then rendered in the configured zone; anywhere west of
 * Greenwich that lands on the previous day. Pinning both ends to UTC keeps the
 * day that is displayed the day that was recorded.
 */
export function parsePlainDate(value: string): Date {
  return new Date(`${value}T00:00:00Z`);
}

/** Pass alongside `parsePlainDate` so formatting cannot shift the day back. */
export const PLAIN_DATE_FORMAT = {
  dateStyle: "medium",
  timeZone: "UTC",
} as const;
