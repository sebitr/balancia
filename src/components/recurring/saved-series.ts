/**
 * What saving a recurring entry is confirmed with.
 *
 * "Recurring entry saved" used to be the whole of it, said the same way
 * whether an expense had just been added or the first one was a month off —
 * and since generation waited for the worker's next tick, it was usually said
 * with nothing to show for it. Somebody who reads "saved" and finds no expense
 * adds the expense by hand, and gets it twice. A series now adds the entries
 * whose dates have come as it is saved (`setUpRecurringExpense`), and the
 * confirmation says which of these happened:
 *
 * - `added` — one or more entries exist now, and more will follow;
 * - `addedLast` — they exist, and that was the end of the series;
 * - `firstOn` — nothing yet, and here is the day the first one arrives;
 * - `plain` — nothing yet and no date to name, which only a series that ends
 *   before its first date can be. It claims no more than that it was saved.
 *
 * One whole sentence per case, in `recurring.saved`, so no language has to
 * assemble one from fragments. The entry drawer is the one place a series is
 * set up — the Recurring screen's own form gave way to a button into it — and
 * the mobile API answers with the same facts.
 */

/**
 * Where a series stands once saved — the part of the action's answer the
 * confirmation reads. Typed here rather than imported from the service, which
 * is server-only.
 */
export interface SavedSeries {
  readonly added: number;
  /** The earliest added entry's date, as a calendar day. */
  readonly addedFrom: string | null;
  /** The next date it adds an entry on, as a calendar day. */
  readonly next: string | null;
}

export type SavedSeriesKey = "added" | "addedLast" | "firstOn" | "plain";

export interface SavedSeriesMessage {
  readonly key: SavedSeriesKey;
  readonly values: Record<string, string | number>;
}

/**
 * The sentence for a saved series, as a key under `recurring.saved` and its
 * values.
 *
 * `day` formats a calendar day the way the reader writes dates; it is passed
 * in so this stays a plain function of its arguments. An answer with no
 * series in it — which a successful save never sends — says only "saved",
 * rather than guessing at what was added.
 */
export function savedSeriesMessage(
  series: SavedSeries | null | undefined,
  description: string,
  day: (date: string) => string,
): SavedSeriesMessage {
  if (series && series.added > 0) {
    const values = {
      description,
      count: series.added,
      from: series.addedFrom ? day(series.addedFrom) : "",
    };
    return series.next
      ? { key: "added", values: { ...values, next: day(series.next) } }
      : { key: "addedLast", values };
  }
  if (series?.next) {
    return { key: "firstOn", values: { description, date: day(series.next) } };
  }
  return { key: "plain", values: { description } };
}

/**
 * Where a series stands once a change to it has been saved. Typed here for
 * the same reason `SavedSeries` is.
 */
export interface UpdatedSeries {
  /** The next date it adds an entry on, as a calendar day. */
  readonly next: string | null;
  /** Whether it is paused; a change leaves that as it was. */
  readonly paused: boolean;
}

export type UpdatedSeriesKey = "next" | "paused" | "ended";

/**
 * The sentence a changed series is confirmed with, as a key under
 * `recurring.updated`.
 *
 * Every one of them ends by saying the entries already added stay as they
 * were, because that is the question an edit to a rule raises — did the rent
 * I just raised rewrite the ten that are already in the group? — and the
 * button that saved it promised as much. Before that it says when the change
 * takes effect: from the next date, or not until it is resumed, or never,
 * for a series with nothing left in it.
 */
export function updatedSeriesMessage(
  updated: UpdatedSeries | null | undefined,
  description: string,
  day: (date: string) => string,
): { readonly key: UpdatedSeriesKey; readonly values: Record<string, string> } {
  if (updated?.paused) return { key: "paused", values: { description } };
  if (updated?.next) {
    return { key: "next", values: { description, date: day(updated.next) } };
  }
  return { key: "ended", values: { description } };
}
