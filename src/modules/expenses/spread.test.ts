import { describe, expect, it } from "vitest";
import {
  categoryTotals,
  isCategorised,
  spreadBands,
  UNCATEGORISED,
  type SpreadEntry,
} from "./spread";

/**
 * The spread has to answer the same question the balances answer, from the
 * same rows — so most of what is checked here is agreement rather than
 * arithmetic: what counts as spending, and which of an expense's two amounts
 * is the one to add up.
 */

const SEPARATE = { mode: "separate" as const, baseCurrency: null };
const CONVERTED = { mode: "converted" as const, baseCurrency: "EUR" };

function entry(overrides: Partial<SpreadEntry> = {}): SpreadEntry {
  return {
    direction: "out",
    category: "groceries",
    amount: 1000n,
    currency: "EUR",
    convertedAmount: null,
    convertedCurrency: null,
    ...overrides,
  };
}

describe("categoryTotals", () => {
  it("adds spending up per category", () => {
    const [spread] = categoryTotals(
      [
        entry({ category: "groceries", amount: 8675n }),
        entry({ category: "restaurants", amount: 2000n }),
        entry({ category: "groceries", amount: 1325n }),
      ],
      SEPARATE,
    );

    expect(spread.currency).toBe("EUR");
    expect(spread.total).toBe(12000n);
    expect(spread.categories).toEqual([
      { category: "groceries", total: 10000n },
      { category: "restaurants", total: 2000n },
    ]);
  });

  it("leaves income out — money coming back is not money spent", () => {
    const [spread] = categoryTotals(
      [
        entry({ category: "lodging", amount: 150000n }),
        entry({ category: "lodging", amount: 12000n, direction: "in" }),
      ],
      SEPARATE,
    );

    expect(spread.total).toBe(150000n);
    expect(spread.categories).toEqual([
      { category: "lodging", total: 150000n },
    ]);
  });

  it("uses the rate frozen on each expense in a converted group", () => {
    const [spread] = categoryTotals(
      [
        entry({ amount: 5000n, currency: "EUR" }),
        entry({
          category: "restaurants",
          amount: 3139n,
          currency: "USD",
          convertedAmount: 2888n,
          convertedCurrency: "EUR",
        }),
      ],
      CONVERTED,
    );

    expect(spread.currency).toBe("EUR");
    expect(spread.total).toBe(7888n);
  });

  it("keeps currencies apart in a separate group, never summing them", () => {
    const spreads = categoryTotals(
      [
        entry({ amount: 5000n, currency: "EUR" }),
        entry({
          category: "restaurants",
          amount: 3139n,
          currency: "USD",
          // A rate frozen on the row is ignored: this group does not convert.
          convertedAmount: 2888n,
          convertedCurrency: "EUR",
        }),
      ],
      SEPARATE,
    );

    expect(spreads).toHaveLength(2);
    expect(spreads.map((spread) => spread.currency)).toEqual(["EUR", "USD"]);
    expect(spreads[1].total).toBe(3139n);
  });

  it("keeps an imported free-text category apart from the code it resembles", () => {
    const [spread] = categoryTotals(
      [
        entry({ category: "travel", amount: 2000n }),
        entry({ category: "Lodging", amount: 150000n }),
        entry({ category: null, amount: 1000n }),
      ],
      SEPARATE,
    );

    expect(spread.categories).toEqual([
      { category: "Lodging", total: 150000n },
      { category: "travel", total: 2000n },
      { category: null, total: 1000n },
    ]);
  });

  it("has nothing to say about a group that has spent nothing", () => {
    expect(categoryTotals([], SEPARATE)).toEqual([]);
    expect(categoryTotals([entry({ direction: "in" })], SEPARATE)).toEqual([]);
  });
});

describe("isCategorised", () => {
  const spreadOf = (entries: SpreadEntry[]) =>
    categoryTotals(entries, SEPARATE)[0];

  it("says no while every expense is still uncategorised", () => {
    const spread = spreadOf([
      entry({ category: null, amount: 25000n }),
      entry({ category: null, amount: 25000n }),
    ]);

    // One band holding the whole total is not a breakdown, so the caller
    // drawing the spine leaves it out.
    expect(spread.categories).toHaveLength(1);
    expect(isCategorised(spread)).toBe(false);
  });

  it("says yes as soon as one expense is filed, however little it is worth", () => {
    const spread = spreadOf([
      entry({ category: null, amount: 25000n }),
      entry({ category: "groceries", amount: 1n }),
    ]);

    expect(isCategorised(spread)).toBe(true);
  });

  it("counts an imported free-text category, which is still somebody's answer", () => {
    expect(isCategorised(spreadOf([entry({ category: "Lodging" })]))).toBe(
      true,
    );
  });
});

describe("spreadBands", () => {
  /** `count` categories, each spending less than the one before it. */
  function spreadOf(count: number) {
    const entries = Array.from({ length: count }, (_, index) =>
      entry({
        category: `c${index}`,
        amount: BigInt((count - index) * 1000),
      }),
    );
    return categoryTotals(entries, SEPARATE)[0];
  }

  it("gives every category its own band while there are colours to go round", () => {
    const bands = spreadBands(spreadOf(5));

    expect(bands).toHaveLength(5);
    expect(bands.map((band) => band.rank)).toEqual([1, 2, 3, 4, 5]);
    expect(bands.map((band) => band.key)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
    ]);
  });

  it("collapses the sixth and beyond into one uncoloured band", () => {
    const bands = spreadBands(spreadOf(7));

    expect(bands).toHaveLength(6);
    const remainder = bands[5];
    expect(remainder.rank).toBeNull();
    expect(remainder.categories).toEqual(["c5", "c6"]);
    // 2000 + 1000 out of 1000+…+7000 = 28000.
    expect(remainder.total).toBe(3000n);
    expect(remainder.key).toBe("c5");
  });

  it("still groups a lone sixth category, so the palette is never stretched", () => {
    const bands = spreadBands(spreadOf(6));

    expect(bands).toHaveLength(6);
    expect(bands[5].rank).toBeNull();
    expect(bands[5].categories).toEqual(["c5"]);
  });

  it("can expose more categories when a taller spine has room", () => {
    const bands = spreadBands(spreadOf(7), 7);

    expect(bands).toHaveLength(7);
    expect(bands.map((band) => band.key)).toEqual([
      "c0",
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "c6",
    ]);
    expect(bands.map((band) => band.rank)).toEqual([1, 2, 3, 4, 5, 1, 2]);
  });

  it("measures shares in tenths of a percent, from the totals themselves", () => {
    const spread = categoryTotals(
      [
        entry({ category: "lodging", amount: 150000n }),
        entry({ category: "restaurants", amount: 11010n }),
        entry({ category: "other", amount: 9500n }),
        entry({ category: "groceries", amount: 8675n }),
        entry({ category: "shopping", amount: 5485n }),
        entry({ category: "utilities", amount: 3990n }),
        entry({ category: "transport", amount: 2250n }),
      ],
      SEPARATE,
    )[0];
    const bands = spreadBands(spread);

    // The figures the design prints: 78.6%, 5.8%, and 3.3% for the remainder.
    expect(bands[0].share).toBe(786);
    expect(bands[1].share).toBe(58);
    expect(bands[5].share).toBe(33);

    // Rounding moves each band by at most half a tenth, so the shares still
    // add up to a whole to within one tenth per band.
    const summed = bands.reduce((sum, band) => sum + band.share, 0);
    expect(Math.abs(summed - 1000)).toBeLessThanOrEqual(bands.length);
  });

  it("keys uncategorised spending as the empty string", () => {
    const spread = categoryTotals([entry({ category: null })], SEPARATE)[0];

    expect(spreadBands(spread)[0].key).toBe(UNCATEGORISED);
  });

  it("does not divide by zero when everything recorded was worth nothing", () => {
    const spread = categoryTotals([entry({ amount: 0n })], SEPARATE)[0];

    expect(spreadBands(spread)[0].share).toBe(0);
  });
});
