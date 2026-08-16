import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  AGE_BUCKETS,
  COUNT_BUCKETS,
  SIZE_BUCKETS,
  bucketAge,
  bucketCount,
  bucketSize,
  daysBetween,
} from "./buckets";

/**
 * Bucket boundaries, one at a time.
 *
 * These are the only numbers that ever leave an installation, so an off-by-one
 * here is not a rounding error — it is a count of expenses landing in a
 * narrower band than the label promises. Every boundary is tested from both
 * sides.
 */

describe("bucketCount", () => {
  it("puts each boundary in the bucket its label claims", () => {
    const boundaries: [number, string][] = [
      [0, "0"],
      [1, "1"],
      [2, "2-5"],
      [5, "2-5"],
      [6, "6-10"],
      [10, "6-10"],
      [11, "11-25"],
      [25, "11-25"],
      [26, "26-50"],
      [50, "26-50"],
      [51, "51-100"],
      [100, "51-100"],
      [101, "101-250"],
      [250, "101-250"],
      [251, "251-500"],
      [500, "251-500"],
      [501, "500+"],
    ];

    for (const [value, expected] of boundaries) {
      expect(bucketCount(value), `count ${value}`).toBe(expected);
    }
  });

  it("keeps very large counts in the closing bucket", () => {
    expect(bucketCount(1_000)).toBe("500+");
    expect(bucketCount(1_000_000)).toBe("500+");
    expect(bucketCount(Number.MAX_SAFE_INTEGER)).toBe("500+");
  });

  it("never falls off the bottom on a value that should not exist", () => {
    // A negative or fractional count is a bug upstream. It must not become a
    // bucket that reads as "some", and it must not become undefined.
    expect(bucketCount(-1)).toBe("0");
    expect(bucketCount(-1000)).toBe("0");
    expect(bucketCount(0.4)).toBe("0");
    expect(bucketCount(1.9)).toBe("1");
    expect(bucketCount(Number.NaN)).toBe("0");
    expect(bucketCount(Number.POSITIVE_INFINITY)).toBe("0");
  });
});

describe("bucketSize", () => {
  it("puts each boundary in the bucket its label claims", () => {
    const boundaries: [number, string][] = [
      [0, "0"],
      [1, "1"],
      [2, "2-5"],
      [5, "2-5"],
      [6, "6-10"],
      [10, "6-10"],
      [11, "11-25"],
      [25, "11-25"],
      [26, "26-50"],
      [50, "26-50"],
      [51, "51-100"],
      [100, "51-100"],
      [101, "100+"],
    ];

    for (const [value, expected] of boundaries) {
      expect(bucketSize(value), `size ${value}`).toBe(expected);
    }
  });

  it("is coarser than the activity ladder at the top", () => {
    // The point of the second ladder: a user count barely moves, so a fine
    // bucket for it would be near-stable identifying material in every report.
    expect(bucketSize(400)).toBe("100+");
    expect(bucketCount(400)).toBe("251-500");
  });
});

describe("bucketAge", () => {
  it("puts each boundary in the bucket its label claims", () => {
    const boundaries: [number, string][] = [
      [0, "0-7d"],
      [7, "0-7d"],
      [8, "8-30d"],
      [30, "8-30d"],
      [31, "31-90d"],
      [90, "31-90d"],
      [91, "91-180d"],
      [180, "91-180d"],
      [181, "181-365d"],
      [365, "181-365d"],
      [366, "365d+"],
      [10_000, "365d+"],
    ];

    for (const [value, expected] of boundaries) {
      expect(bucketAge(value), `age ${value}`).toBe(expected);
    }
  });
});

describe("daysBetween", () => {
  it("counts whole elapsed days", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    expect(daysBetween(from, new Date("2026-01-01T23:59:59Z"))).toBe(0);
    expect(daysBetween(from, new Date("2026-01-02T00:00:00Z"))).toBe(1);
    expect(daysBetween(from, new Date("2026-04-01T00:00:00Z"))).toBe(90);
  });

  it("floors at zero when the clock has gone backwards", () => {
    // A restored backup or a container without NTP must not produce a negative
    // age and fall off the bottom of the ladder.
    const from = new Date("2026-06-01T00:00:00Z");
    expect(daysBetween(from, new Date("2026-01-01T00:00:00Z"))).toBe(0);
    expect(bucketAge(daysBetween(from, new Date("2020-01-01T00:00:00Z")))).toBe(
      "0-7d",
    );
  });
});

describe("every bucket function", () => {
  it("only ever returns a label from its own ladder", () => {
    fc.assert(
      fc.property(fc.integer({ min: -10_000, max: 10_000_000 }), (value) => {
        expect(COUNT_BUCKETS).toContain(bucketCount(value));
        expect(SIZE_BUCKETS).toContain(bucketSize(value));
        expect(AGE_BUCKETS).toContain(bucketAge(value));
      }),
    );
  });

  it("is monotonic: a larger count never lands in a smaller bucket", () => {
    // The property that makes a bucket meaningful. Without it, a report could
    // say "2-5" for a week busier than one that said "26-50".
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 100_000 }),
        fc.integer({ min: 0, max: 100_000 }),
        (a, b) => {
          const [small, large] = a <= b ? [a, b] : [b, a];
          expect(COUNT_BUCKETS.indexOf(bucketCount(small))).toBeLessThanOrEqual(
            COUNT_BUCKETS.indexOf(bucketCount(large)),
          );
          expect(SIZE_BUCKETS.indexOf(bucketSize(small))).toBeLessThanOrEqual(
            SIZE_BUCKETS.indexOf(bucketSize(large)),
          );
          expect(AGE_BUCKETS.indexOf(bucketAge(small))).toBeLessThanOrEqual(
            AGE_BUCKETS.indexOf(bucketAge(large)),
          );
        },
      ),
    );
  });

  it("never returns a label that could be mistaken for an exact number", () => {
    // Except for the two smallest, where the bucket *is* the number and
    // pretending otherwise would be less honest, not more.
    const exact = new Set(["0", "1"]);
    for (const label of [...COUNT_BUCKETS, ...SIZE_BUCKETS]) {
      if (exact.has(label)) continue;
      expect(label, `${label} should be a range`).toMatch(/[-+]/);
    }
  });
});
