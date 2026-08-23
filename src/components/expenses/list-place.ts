/**
 * Where the reader had got to in the transactions list.
 *
 * Opening a transaction unmounts the list, and the list is not a fixed page:
 * it reads itself in a screenful at a time, so what comes back on the way home
 * is the first forty rows and the top of the screen. A reader who had scrolled
 * to 2019, opened a hotel bill, corrected the amount and pressed back landed in
 * last week — with the row they had just edited three hundred rows below them.
 *
 * The filters travel in the URL, which is where they already live. What cannot
 * go there is this: how much of the list had been read in, and how far down it
 * the reader was. Those are facts about one visit rather than about the screen,
 * and a URL that carried them would be a URL nobody could sensibly share.
 *
 * `sessionStorage` rather than `localStorage`: it lasts exactly as long as the
 * tab, which is exactly as long as the journey it describes.
 *
 * Reading and forgetting are two functions rather than one `take`, because the
 * list has to read this on its first render — the number of rows to fetch
 * depends on it — and a render that empties a store is a render that answers
 * differently the second time it is run. So the read is pure, and the erasing
 * happens in an effect, which is where touching something outside React
 * belongs.
 */

export interface ListPlace {
  /** How many rows had been read in — filters not yet applied. */
  readonly rows: number;
  /** How far down the page the reader was. */
  readonly scrollY: number;
  /**
   * The filters that produced that list, from `listQuery`.
   *
   * A different set is a different list, and there is no honest offset into
   * one from the other: 900px down "everything" and 900px down "Lodging only"
   * are not the same place, and restoring one into the other would land the
   * reader somewhere they have never been.
   */
  readonly search: string;
}

/**
 * One slot, not one per group.
 *
 * Only one list is ever being read at a time, and a record keyed per group
 * would accumulate a position for every group the reader has ever opened —
 * none of which is worth the storage, and the oldest of which would be a
 * position in a list that has changed shape many times since.
 */
const KEY = "balancia:transactions-place";

interface Stored extends ListPlace {
  readonly groupId: string;
}

/** Remember the place, on the way into an entry's own screen. */
export function rememberPlace(groupId: string, place: ListPlace): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ groupId, ...place }));
  } catch {
    // Private browsing, or a full quota. A place that cannot be written is a
    // worse trip back, not a broken one — the list still works, it just opens
    // where it always used to.
  }
}

/** The place, if the one on record belongs to this group's list. */
export function readPlace(groupId: string): ListPlace | null {
  let raw: string | null = null;
  try {
    raw = sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;

  try {
    const stored: unknown = JSON.parse(raw);
    if (!isStored(stored) || stored.groupId !== groupId) return null;
    return {
      rows: stored.rows,
      scrollY: stored.scrollY,
      search: stored.search,
    };
  } catch {
    // Written by an older version of this file, or by hand. Nothing here is
    // worth reporting: the list simply opens at the top.
    return null;
  }
}

/**
 * Spend it, used or not.
 *
 * Called as soon as the list has read it, because it describes one trip and
 * the trip is over. Left behind, it would fire again on the next arrival from
 * anywhere — the tab bar, an hour later — and drop a reader who asked for the
 * list a thousand pixels into a position they had forgotten holding.
 */
export function forgetPlace(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing was readable, so there is nothing to erase.
  }
}

function isStored(value: unknown): value is Stored {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.groupId === "string" &&
    typeof record.search === "string" &&
    Number.isInteger(record.rows) &&
    (record.rows as number) >= 0 &&
    typeof record.scrollY === "number" &&
    Number.isFinite(record.scrollY)
  );
}
