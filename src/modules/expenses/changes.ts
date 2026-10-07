import type { EntryDirection } from "./direction";

/**
 * What an edit changed, for the activity log.
 *
 * An expense is replaced whole on every edit, so the write itself cannot say
 * what the person actually touched, and the log said "edited an expense" for a
 * fixed typo and for a payer swapped alike. Comparing the row as it was with
 * the row as it is now costs one read of what is about to be overwritten, and
 * lets the history say which of these moved.
 *
 * The result names fields, never values: values that are worth a line of their
 * own — the amount, the description — are recorded beside it by the caller,
 * and the rest (a note, a split) are nobody's business but the entry's.
 *
 * A field is only said to have moved when the person moved it. Raising the
 * amount rescales everything derived from it — the payer's contribution, each
 * share of an equal split — and a line that listed "the amount, who paid and
 * the split" for a change of one figure would be accurate and no use.
 */

export type ExpenseField =
  | "description"
  | "amount"
  | "direction"
  | "date"
  | "category"
  | "payers"
  | "split"
  | "notes";

/** One side of an edit: just enough of an expense to tell two apart. */
export interface ExpenseSnapshot {
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly direction: EntryDirection;
  readonly expenseDate: string;
  readonly category: string | null;
  readonly subcategory: string | null;
  readonly notes: string | null;
  readonly splitMethod: string;
  /** What was asked of the split — who is in it, and the value each gave. */
  readonly splitEntries: readonly SplitEntry[];
  readonly payers: readonly Contribution[];
}

export interface SplitEntry {
  readonly participantId: string;
  readonly value?: string | null;
}

interface Contribution {
  readonly participantId: string;
  readonly amount: bigint;
}

/** Who is in a list, however it is ordered. */
function peopleIn(
  entries: readonly { readonly participantId: string }[],
): string {
  return [...new Set(entries.map((entry) => entry.participantId))]
    .sort()
    .join("|");
}

function contributionsOf(payers: readonly Contribution[]): string {
  return payers
    .map((payer) => `${payer.participantId}:${payer.amount}`)
    .sort()
    .join("|");
}

function valuesOf(entries: readonly SplitEntry[]): string {
  return entries
    .map((entry) => `${entry.participantId}:${entry.value ?? ""}`)
    .sort()
    .join("|");
}

/**
 * The fields of `after` that differ from `before`, in the order a reader would
 * list them. Empty when the edit changed nothing the entry records.
 */
export function changedFields(
  before: ExpenseSnapshot,
  after: ExpenseSnapshot,
): ExpenseField[] {
  const changed: ExpenseField[] = [];
  const figureMoved =
    before.amount !== after.amount || before.currency !== after.currency;

  if (before.description !== after.description) changed.push("description");
  if (figureMoved) changed.push("amount");
  if (before.direction !== after.direction) changed.push("direction");
  if (before.expenseDate !== after.expenseDate) changed.push("date");
  if (
    (before.category ?? "") !== (after.category ?? "") ||
    (before.subcategory ?? "") !== (after.subcategory ?? "")
  ) {
    changed.push("category");
  }

  // Who paid. Several payers' contributions must add up to the total, so when
  // the total moved theirs moved with it; only who is paying says anything.
  if (
    peopleIn(before.payers) !== peopleIn(after.payers) ||
    (!figureMoved &&
      contributionsOf(before.payers) !== contributionsOf(after.payers))
  ) {
    changed.push("payers");
  }

  // The split. An equal split is only its members; percentages and shares are
  // their own values and do not follow the total; exact amounts must add up to
  // it, so they move whenever it does.
  const valuesMeanSomething =
    before.splitMethod !== "equal" &&
    !(before.splitMethod === "exact" && figureMoved);
  if (
    before.splitMethod !== after.splitMethod ||
    peopleIn(before.splitEntries) !== peopleIn(after.splitEntries) ||
    (valuesMeanSomething &&
      valuesOf(before.splitEntries) !== valuesOf(after.splitEntries))
  ) {
    changed.push("split");
  }

  if ((before.notes ?? "") !== (after.notes ?? "")) changed.push("notes");

  return changed;
}

/**
 * The entries of a stored split input, or null when what is stored is not one.
 *
 * Read back out of a JSON column, so nothing about it is taken on trust.
 */
export function splitEntriesOf(stored: unknown): SplitEntry[] | null {
  if (stored === null || typeof stored !== "object") return null;
  const entries = (stored as { entries?: unknown }).entries;
  if (!Array.isArray(entries)) return null;

  const read: SplitEntry[] = [];
  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") return null;
    const { participantId, value } = entry as {
      participantId?: unknown;
      value?: unknown;
    };
    if (typeof participantId !== "string") return null;
    read.push({
      participantId,
      value: typeof value === "string" ? value : null,
    });
  }
  return read;
}
