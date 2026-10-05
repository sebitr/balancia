import Decimal from "decimal.js";
import {
  formatMinorUnits,
  parseAmountToMinor,
  readSplitValue,
} from "@/components/expenses/expense-form-logic";
import { giveRestTo } from "./multi-payer";

/**
 * The taps that save typing in the split's own fields.
 *
 * The "Paid by" panel above already has its shortcuts — just one person paid,
 * split the payment equally, give the rest to somebody — and the split below
 * it made the reader do the same sums by hand. An exact split that is €5 short
 * wants subtracting; a set of shares wants 1, 2 or 3 nearly every time, and a
 * phone keyboard is a lot of screen for one digit.
 */

/**
 * Who "the remaining" on an exact split goes to.
 *
 * The last person the reader has not touched yet: switching to exact seeds an
 * equal split, so the people still on their seeded amount are the ones whose
 * figure is "whatever is left", and the reader works down the list. Once every
 * field has been touched, the first one at zero — a field cleared to be filled
 * in later. Failing both, the last person, the same last resort the payer
 * chip has: it is a guess, and it costs a tap to type over.
 */
export function remainingCandidate(input: {
  participantIds: readonly string[];
  values: Readonly<Record<string, string>>;
  /** The fields the reader has typed into since choosing this method. */
  edited: ReadonlySet<string>;
  currency: string;
}): string | null {
  const { participantIds, values, edited, currency } = input;

  const untouched = participantIds.filter((id) => !edited.has(id));
  const last = untouched.at(-1);
  if (last !== undefined) return last;

  const atZero = participantIds.find((id) => {
    const text = readSplitValue(values[id]);
    if (text === "") return true;
    const parsed = parseAmountToMinor(text, currency);
    return parsed.ok && parsed.value === 0n;
  });
  return atZero ?? participantIds.at(-1) ?? null;
}

/**
 * The exact split with what is still unassigned added to one person.
 *
 * The payer panel's "give the rest" arithmetic, pointed at the split: the
 * person ends up on the total less everybody else, which is their own figure
 * plus the shortfall. Fields are read the way the preview reads them first, so
 * "12,50" counts as the twelve-fifty the note already counted.
 */
export function giveRemaining(input: {
  values: Readonly<Record<string, string>>;
  participantId: string;
  participantIds: readonly string[];
  currency: string;
  totalMinor: bigint;
}): Record<string, string> {
  const { values, participantId, participantIds, currency, totalMinor } = input;
  const read = Object.fromEntries(
    participantIds.map((id) => [id, readSplitValue(values[id])]),
  );
  const given = giveRestTo({
    amounts: read,
    participantId,
    memberIds: participantIds,
    currency,
    totalMinor,
    format: (minor, code) => formatMinorUnits(minor.toString(), code),
  });
  // Only the one field changes; the others stay as the reader typed them.
  return { ...values, [participantId]: given[participantId] ?? "" };
}

/**
 * One share more or fewer, never fewer than none.
 *
 * Steps from whatever is in the field, fractions included — a share of 1.5
 * goes to 2.5, not to 2 — and an empty or unreadable field counts as nothing,
 * which is what the preview already makes of it.
 */
export function stepShare(raw: string | undefined, delta: 1 | -1): string {
  return Decimal.max(0, shareOf(raw).plus(delta)).toString();
}

/** Whether a field holds no share at all, so there is nothing to take away. */
export function hasNoShare(raw: string | undefined): boolean {
  return shareOf(raw).isZero();
}

function shareOf(raw: string | undefined): Decimal {
  const text = readSplitValue(raw);
  if (text === "") return new Decimal(0);
  try {
    const share = new Decimal(text);
    return share.isFinite() && share.isPositive() ? share : new Decimal(0);
  } catch {
    // Not a number yet; stepping starts from nothing, as the preview does.
    return new Decimal(0);
  }
}
