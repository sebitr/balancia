import type { ParsedReceipt } from "./types";

/**
 * Checking a parsed receipt against itself.
 *
 * OCR gets digits wrong, and the way it gets them wrong is usually invisible:
 * `19.00` read as `19.60` still looks like a price. What it cannot fake is
 * arithmetic — a misread item makes the items stop adding up to the subtotal,
 * and a misread tax makes the parts stop adding up to the total.
 *
 * So every number is checked against every other number, and anything that does
 * not reconcile is *reported*, never corrected. Silently adjusting a value to
 * make the sums work would hide exactly the error the check exists to find, and
 * would put a number in the expense that nobody read off the paper.
 */

export type ReceiptIssueCode =
  | "noTotal"
  | "noItems"
  | "itemsMissingSubtotal"
  | "partsMissingTotal"
  | "itemsExceedTotal"
  | "negativeTotal";

export type ReceiptIssueSeverity = "warning" | "info";

/**
 * A finding, as a code plus its numbers. The message is the UI's business:
 * amounts have to be formatted in the reader's locale and currency, which this
 * module has no opinion about.
 */
export interface ReceiptIssue {
  readonly code: ReceiptIssueCode;
  readonly severity: ReceiptIssueSeverity;
  /** Minor units as decimal strings, ready for the caller to format. */
  readonly params: Readonly<Record<string, string>>;
}

export interface ValidationOptions {
  /**
   * How far two sides may differ and still count as reconciled, in minor
   * units. Two covers ordinary rounding, including the Swiss habit of
   * rounding a cash total to the nearest five rappen.
   */
  readonly toleranceMinorUnits?: bigint;
}

const DEFAULT_TOLERANCE = 2n;

function absolute(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function sumItems(receipt: ParsedReceipt): bigint {
  return receipt.items.reduce((total, item) => total + item.total, 0n);
}

/**
 * Everything that does not add up, most important first.
 *
 * An empty array means the numbers are mutually consistent — which is not the
 * same as correct, and is why the review screen still shows every value.
 */
export function validateReceipt(
  receipt: ParsedReceipt,
  options: ValidationOptions = {},
): readonly ReceiptIssue[] {
  const tolerance = options.toleranceMinorUnits ?? DEFAULT_TOLERANCE;
  const issues: ReceiptIssue[] = [];

  const items = sumItems(receipt);
  const hasItems = receipt.items.length > 0;

  if (receipt.total === undefined) {
    issues.push({ code: "noTotal", severity: "warning", params: {} });
  } else if (receipt.total < 0n) {
    issues.push({
      code: "negativeTotal",
      severity: "warning",
      params: { total: receipt.total.toString() },
    });
  }

  if (!hasItems) {
    issues.push({ code: "noItems", severity: "info", params: {} });
  }

  /*
   * Where the service charge sits is genuinely ambiguous, and the two layouts
   * are both common:
   *
   *   items ─► subtotal ─► + coperto ─► + IVA ─► total     (added after)
   *   items ─► + coperto ─► subtotal ─► + IVA ─► total     (already inside)
   *
   * A Milanese receipt reading `Totale parziale 264,00` where the items come
   * to 254,00 and the coperto is 10,00 is *correct* under the second reading —
   * but assuming the first flags it twice, on a receipt that was read
   * perfectly. Warnings that fire on good input are how people learn to
   * dismiss warnings, so a reading that reconciles is accepted.
   */
  const service = receipt.service ?? 0n;

  const reconciles = (
    candidates: readonly bigint[],
    against: bigint,
  ): boolean =>
    candidates.some((value) => absolute(value - against) <= tolerance);

  // Items against the subtotal, when the receipt printed one.
  if (hasItems && receipt.subtotal !== undefined) {
    const difference = items - receipt.subtotal;
    if (!reconciles([items, items + service], receipt.subtotal)) {
      issues.push({
        code: "itemsMissingSubtotal",
        severity: "warning",
        params: {
          items: items.toString(),
          subtotal: receipt.subtotal.toString(),
          difference: difference.toString(),
        },
      });
    }
  }

  if (receipt.total !== undefined) {
    // The parts against the total. The subtotal is preferred as the base when
    // there is one, because it is the receipt's own statement of what the
    // items came to — using the read items instead would report the same
    // discrepancy twice.
    const base = receipt.subtotal ?? (hasItems ? items : undefined);
    if (base !== undefined) {
      const parts = base + (receipt.tax ?? 0n) + (receipt.tip ?? 0n) + service;
      // The same ambiguity from the other side: when the service charge is
      // already inside the printed subtotal, adding it again overshoots the
      // total by exactly that charge.
      const withServiceInsideSubtotal =
        receipt.subtotal !== undefined ? [parts - service] : [];

      const difference = parts - receipt.total;
      if (!reconciles([parts, ...withServiceInsideSubtotal], receipt.total)) {
        issues.push({
          code: "partsMissingTotal",
          severity: "warning",
          params: {
            parts: parts.toString(),
            total: receipt.total.toString(),
            difference: difference.toString(),
          },
        });
      }
    }

    /*
     * Items alone exceeding the total is its own finding: it means a discount
     * or a correction line was missed, and splitting by item would over-charge
     * the table rather than merely mis-attribute it.
     *
     * Only said when the subtotal has not already said it, though. A receipt
     * whose items overshoot its own subtotal usually overshoots its total by
     * the same amount, and stacking two banners for one discrepancy reads as
     * two problems — which makes the screen look like the scan went badly when
     * what actually happened is that the paper does not add up.
     */
    const alreadyReported = issues.some(
      (issue) => issue.code === "itemsMissingSubtotal",
    );
    if (!alreadyReported && hasItems && items - receipt.total > tolerance) {
      issues.push({
        code: "itemsExceedTotal",
        severity: "warning",
        params: {
          items: items.toString(),
          total: receipt.total.toString(),
          difference: (items - receipt.total).toString(),
        },
      });
    }
  }

  return issues;
}

/** Convenience for the UI: whether anything needs the reader's attention. */
export function hasBlockingIssues(issues: readonly ReceiptIssue[]): boolean {
  return issues.some((issue) => issue.severity === "warning");
}
