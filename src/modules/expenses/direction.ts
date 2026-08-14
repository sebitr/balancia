/**
 * Which way an entry moved money.
 *
 * Balancia records spending and income in the same table, with the same
 * payers-and-shares shape. What separates them is one sign:
 *
 *   - `out` — somebody paid for the group. The others owe them their share.
 *   - `in`  — somebody received money that belongs to the group. They owe the
 *             others their share instead.
 *
 * Amounts are stored positive either way. Nothing downstream should ever see a
 * negative `amount` and have to guess what it meant, so the sign is applied at
 * the point of use — in the balance engine — and nowhere else.
 */

export const ENTRY_DIRECTIONS = ["out", "in"] as const;
export type EntryDirection = (typeof ENTRY_DIRECTIONS)[number];

export const DEFAULT_DIRECTION: EntryDirection = "out";

export function isEntryDirection(value: unknown): value is EntryDirection {
  return (
    typeof value === "string" &&
    (ENTRY_DIRECTIONS as readonly string[]).includes(value)
  );
}

/**
 * The multiplier the balance engine applies to an entry's payers and shares.
 *
 * Income is spending in reverse, so `in` is simply `-1`.
 */
export function signOf(direction: EntryDirection = DEFAULT_DIRECTION): bigint {
  return direction === "in" ? -1n : 1n;
}

/**
 * Whether an entry counts as spending.
 *
 * Totals, per-category reporting and exports all ask this question, and they
 * must all get the same answer — an income filed under "groceries" is not
 * 84.60 spent on groceries, it is 84.60 that came back.
 */
export function isSpending(
  direction: EntryDirection = DEFAULT_DIRECTION,
): boolean {
  return direction === "out";
}
