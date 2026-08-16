/**
 * Coarse buckets.
 *
 * Every number that leaves this instance is a bucket label, never a count. Two
 * reasons, and the second is the important one:
 *
 *  1. An exact count answers questions nobody asked. "Did feature X get used?"
 *     is answered as well by "11-25" as by "17".
 *  2. Exact counts fingerprint. There is no installation identifier in a
 *     Balancia report (see docs/telemetry.md), so the only thing that could tie
 *     two reports to the same instance is the shape of the numbers in them.
 *     Buckets collapse that shape into a handful of values that thousands of
 *     installations share.
 *
 * Two ladders, because the two kinds of number leak differently. Activity
 * counts (how many expenses last week) move around, so they can afford a fine
 * top end. Sizes (how many people use this instance) barely move at all, which
 * makes them the strongest fingerprint in the report — so their ladder stops
 * early and everything above it is one label.
 *
 * Pure functions over numbers: nothing here reaches a database, and nothing
 * here can be handed a domain object.
 */

/** Activity buckets — how much of something happened in a window. */
export const COUNT_BUCKETS = [
  "0",
  "1",
  "2-5",
  "6-10",
  "11-25",
  "26-50",
  "51-100",
  "101-250",
  "251-500",
  "500+",
] as const;

export type CountBucket = (typeof COUNT_BUCKETS)[number];

/**
 * Size buckets — how big this installation is.
 *
 * Deliberately coarser than the activity ladder above: it ends at `100+`,
 * where the activity ladder goes on to `500+`. An instance's user count is
 * close to constant, so a fine bucket for it would be near-stable identifying
 * material in every weekly report. "More than a hundred people" is all the
 * resolution this needs.
 */
export const SIZE_BUCKETS = [
  "0",
  "1",
  "2-5",
  "6-10",
  "11-25",
  "26-50",
  "51-100",
  "100+",
] as const;

export type SizeBucket = (typeof SIZE_BUCKETS)[number];

/** How long this installation has existed, coarsely. */
export const AGE_BUCKETS = [
  "0-7d",
  "8-30d",
  "31-90d",
  "91-180d",
  "181-365d",
  "365d+",
] as const;

export type AgeBucket = (typeof AGE_BUCKETS)[number];

/**
 * Upper bound of each activity bucket, in order. `null` closes the ladder.
 *
 * Written as bounds rather than as a chain of comparisons so the boundaries
 * are readable in one glance and testable one at a time.
 */
const COUNT_BOUNDS: readonly (readonly [number | null, CountBucket])[] = [
  [0, "0"],
  [1, "1"],
  [5, "2-5"],
  [10, "6-10"],
  [25, "11-25"],
  [50, "26-50"],
  [100, "51-100"],
  [250, "101-250"],
  [500, "251-500"],
  [null, "500+"],
];

const SIZE_BOUNDS: readonly (readonly [number | null, SizeBucket])[] = [
  [0, "0"],
  [1, "1"],
  [5, "2-5"],
  [10, "6-10"],
  [25, "11-25"],
  [50, "26-50"],
  [100, "51-100"],
  [null, "100+"],
];

const AGE_BOUNDS: readonly (readonly [number | null, AgeBucket])[] = [
  [7, "0-7d"],
  [30, "8-30d"],
  [90, "31-90d"],
  [180, "91-180d"],
  [365, "181-365d"],
  [null, "365d+"],
];

/**
 * Normalises anything numeric to a whole, non-negative count.
 *
 * A negative or fractional input is a bug upstream, not something to propagate
 * into a report: `NaN` must never become a bucket, and `-1` must never become
 * `"0"` by accident of comparison order.
 */
function whole(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function classify<T extends string>(
  value: number,
  bounds: readonly (readonly [number | null, T])[],
): T {
  const count = whole(value);
  for (const [upper, label] of bounds) {
    if (upper === null || count <= upper) return label;
  }
  // Unreachable: every ladder ends with a null bound. Kept total anyway.
  return bounds[bounds.length - 1][1];
}

/** Activity in a window — expenses created, receipts attached, and so on. */
export function bucketCount(value: number): CountBucket {
  return classify(value, COUNT_BOUNDS);
}

/** Installation size — people, groups. Coarser on purpose; see above. */
export function bucketSize(value: number): SizeBucket {
  return classify(value, SIZE_BOUNDS);
}

/** How old the installation is, from a whole number of days. */
export function bucketAge(days: number): AgeBucket {
  return classify(days, AGE_BOUNDS);
}

/**
 * Whole days between two instants, floored at zero.
 *
 * A clock that has gone backwards — a restored backup, a container with no
 * NTP — must not produce a negative age and fall off the bottom of the ladder.
 */
export function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}
