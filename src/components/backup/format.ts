/**
 * How the backup screens write a size.
 *
 * Decimal units (kB, MB, GB), because those are what a cloud plan is sold and
 * measured in — a person comparing "38 MB of receipts" with "15 GB free" should
 * not have to wonder which kilo is meant. Intl does the unit names and the
 * decimal separator, so French reads "38 Mo".
 */

const UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"] as const;

export function formatBytes(bytes: number, locale: string): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const formatted = new Intl.NumberFormat(locale, {
    style: "unit",
    unit: UNITS[unit],
    unitDisplay: "short",
    // Whole bytes and kilobytes; one decimal beyond that, and none once the
    // number is large enough that the decimal is noise.
    maximumFractionDigits: unit < 2 || value >= 100 ? 0 : 1,
  });
  return formatted.format(value);
}
