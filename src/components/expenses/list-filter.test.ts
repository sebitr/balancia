import { describe, expect, it } from "vitest";
import {
  clearedFilter,
  filterDimensions,
  filterParams,
  NO_FILTER,
  readFilter,
  selectRows,
  sortableByAmount,
  type ListFilter,
  type RowView,
} from "./list-filter";

/**
 * The predicate the whole screen rests on.
 *
 * Two things depend on it agreeing with itself: the rows on screen, and the
 * number the sheet's apply button promises before they are. So the interesting
 * cases live here, in a unit test, rather than being inferred from clicking
 * chips — and every axis the sheet offers has one, because an axis that is
 * silently a no-op looks exactly like an axis with nothing to match.
 */

function row(overrides: Partial<RowView> = {}): RowView {
  return {
    kind: "expense",
    id: "e1",
    date: "2026-08-13",
    title: "Something",
    amount: "2500",
    currency: "EUR",
    category: "groceries",
    subcategory: null,
    note: null,
    position: "-1250",
    revenue: false,
    recurring: false,
    payers: ["seb"],
    foreign: false,
    receipt: false,
    ...overrides,
  };
}

const CONTEXT = { today: "2026-08-24", dateText: (date: string) => date };

function filter(overrides: Partial<ListFilter> = {}): ListFilter {
  return { ...NO_FILTER, ...overrides };
}

/** The ids that survive, in the order they survive in. */
function kept(rows: readonly RowView[], applied: ListFilter): string[] {
  return selectRows(rows, applied, CONTEXT).map((entry) => entry.id);
}

describe("selectRows", () => {
  it("keeps every row when nothing is filtered", () => {
    const rows = [row({ id: "a" }), row({ id: "b" })];
    expect(kept(rows, NO_FILTER)).toEqual(["a", "b"]);
  });

  it("reads several chips in one section as *or*", () => {
    const rows = [
      row({ id: "spend" }),
      row({ id: "income", revenue: true }),
      row({ id: "repaid", kind: "settlement", category: null }),
    ];
    expect(kept(rows, filter({ kinds: ["expense", "settlement"] }))).toEqual([
      "spend",
      "repaid",
    ]);
  });

  it("reads two sections as *and*", () => {
    const rows = [
      row({ id: "mine", payers: ["seb"] }),
      row({ id: "theirs", payers: ["padi"] }),
      row({ id: "old", payers: ["seb"], date: "2025-01-04" }),
    ];
    const applied = filter({ payers: ["seb"], when: "year" });
    expect(kept(rows, applied)).toEqual(["mine"]);
  });

  describe("category", () => {
    it("takes the whole category, subcategories and all", () => {
      const rows = [
        row({ id: "bare", category: "home", subcategory: null }),
        row({ id: "rent", category: "home", subcategory: "rent" }),
        row({ id: "other", category: "transport" }),
      ];
      expect(kept(rows, filter({ categories: ["home"] }))).toEqual([
        "bare",
        "rent",
      ]);
    });

    it("takes only the pair when a subcategory is the filter", () => {
      const rows = [
        row({ id: "bare", category: "home", subcategory: null }),
        row({ id: "rent", category: "home", subcategory: "rent" }),
        row({ id: "gas", category: "home", subcategory: "gas" }),
      ];
      expect(kept(rows, filter({ subcategories: ["home.rent"] }))).toEqual([
        "rent",
      ]);
    });

    it("does not confuse the same subcategory code under two parents", () => {
      const rows = [
        row({ id: "shirt", category: "shopping", subcategory: "clothing" }),
        row({ id: "romper", category: "kids_family", subcategory: "clothing" }),
      ];
      expect(
        kept(rows, filter({ subcategories: ["shopping.clothing"] })),
      ).toEqual(["shirt"]);
    });

    it("filters on uncategorised spending, which stores no category at all", () => {
      const rows = [row({ id: "named" }), row({ id: "bare", category: null })];
      expect(kept(rows, filter({ categories: [""] }))).toEqual(["bare"]);
    });
  });

  describe("when", () => {
    const rows = [
      row({ id: "today", date: "2026-08-24" }),
      row({ id: "lastMonth", date: "2026-07-30" }),
      row({ id: "lastYear", date: "2025-11-02" }),
    ];

    it("measures this month from today in the group's own timezone", () => {
      expect(kept(rows, filter({ when: "month" }))).toEqual(["today"]);
    });

    it("measures this year the same way", () => {
      expect(kept(rows, filter({ when: "year" }))).toEqual([
        "today",
        "lastMonth",
      ]);
    });

    it("takes both ends of a custom range inclusively", () => {
      const applied = filter({
        when: "custom",
        from: "2026-07-30",
        to: "2026-08-24",
      });
      expect(kept(rows, applied)).toEqual(["today", "lastMonth"]);
    });

    it("ignores a range that is left over from another period", () => {
      // `from` and `to` are only read under `custom`; a stale pair must not
      // narrow a list the reader has told to show any time.
      const applied = filter({
        when: "any",
        from: "2026-08-01",
        to: "2026-08-02",
      });
      expect(kept(rows, applied)).toHaveLength(3);
    });
  });

  describe("amount", () => {
    it("reads the bound in the row's own currency", () => {
      const rows = [
        row({ id: "eur", amount: "9900", currency: "EUR" }),
        row({ id: "jpy", amount: "9900", currency: "JPY" }),
      ];
      // 100 is 10 000 minor units of EUR and 100 of JPY, so the yen row —
      // which is 9 900 yen — clears a floor the euro row misses.
      expect(kept(rows, filter({ min: "100" }))).toEqual(["jpy"]);
    });

    it("takes either bound on its own", () => {
      // 5.00, 10.00 and 500.00, so a bound of 10 lands exactly on the middle
      // one — which both bounds must keep, since neither excludes its own end.
      const rows = [
        row({ id: "small", amount: "500" }),
        row({ id: "mid", amount: "1000" }),
        row({ id: "big", amount: "50000" }),
      ];
      expect(kept(rows, filter({ min: "10" }))).toEqual(["mid", "big"]);
      expect(kept(rows, filter({ max: "10" }))).toEqual(["small", "mid"]);
    });

    it("compares magnitude, so income is not filtered out for running backwards", () => {
      const rows = [row({ id: "back", amount: "5000", revenue: true })];
      expect(kept(rows, filter({ min: "10", max: "100" }))).toEqual(["back"]);
    });

    it("ignores a bound that is not a number yet", () => {
      const rows = [row({ id: "a", amount: "500" })];
      for (const min of ["", " ", ".", "abc", "-5"]) {
        expect(kept(rows, filter({ min }))).toEqual(["a"]);
      }
    });

    it("takes a comma for a decimal point, and cuts extra digits", () => {
      const rows = [row({ id: "a", amount: "1250" })];
      expect(kept(rows, filter({ min: "12,50" }))).toEqual(["a"]);
      expect(kept(rows, filter({ min: "12,501" }))).toEqual(["a"]);
      expect(kept(rows, filter({ min: "12,51" }))).toEqual([]);
    });
  });

  describe("your position", () => {
    it("splits owed, owing and neither the way the row draws them", () => {
      const rows = [
        row({ id: "owe", position: "-1250" }),
        row({ id: "back", position: "6000" }),
        row({ id: "even", position: "0" }),
        row({ id: "notMine", position: null }),
      ];
      expect(kept(rows, filter({ positions: ["owe"] }))).toEqual(["owe"]);
      expect(kept(rows, filter({ positions: ["back"] }))).toEqual(["back"]);
      // Settled to nothing and never yours are both "nothing for you", which
      // is what the list says by printing no position under either.
      expect(kept(rows, filter({ positions: ["flat"] }))).toEqual([
        "even",
        "notMine",
      ]);
    });

    it("counts a repayment as nothing for you, whatever its amount", () => {
      const rows = [
        row({
          id: "repaid",
          kind: "settlement",
          category: null,
          position: "74000",
        }),
      ];
      expect(kept(rows, filter({ positions: ["back"] }))).toEqual([]);
      expect(kept(rows, filter({ positions: ["flat"] }))).toEqual(["repaid"]);
    });
  });

  describe("only show", () => {
    const rows = [
      row({ id: "plain" }),
      row({ id: "series", recurring: true }),
      row({ id: "receipt", receipt: true }),
      row({ id: "both", recurring: true, receipt: true }),
    ];

    it("requires the property", () => {
      expect(kept(rows, filter({ properties: ["series"] }))).toEqual([
        "series",
        "both",
      ]);
    });

    it("requires all of them together, which is what the section promises", () => {
      expect(kept(rows, filter({ properties: ["series", "receipt"] }))).toEqual(
        ["both"],
      );
    });

    it("finds an entry recorded in a currency the group does not keep", () => {
      const mixed = [row({ id: "home" }), row({ id: "away", foreign: true })];
      expect(kept(mixed, filter({ properties: ["foreign"] }))).toEqual([
        "away",
      ]);
    });
  });

  describe("paid by", () => {
    it("means any of, and matches a bill several people put money into", () => {
      const rows = [
        row({ id: "seb", payers: ["seb"] }),
        row({ id: "padi", payers: ["padi"] }),
        row({ id: "shared", payers: ["padi", "cyril"] }),
      ];
      expect(kept(rows, filter({ payers: ["seb", "cyril"] }))).toEqual([
        "seb",
        "shared",
      ]);
    });
  });

  describe("search", () => {
    it("matches the title, a repayment's note, and the date as it is shown", () => {
      const rows = [
        row({ id: "title", title: "Hôtel du Lac" }),
        row({ id: "note", title: "Seb paid Padi", note: "for the hotel" }),
        row({ id: "date", title: "Uber", date: "2019-07-02" }),
      ];
      expect(kept(rows, filter({ query: "hotel" }))).toEqual(["note"]);
      expect(kept(rows, filter({ query: "2019" }))).toEqual(["date"]);
    });
  });

  describe("sort", () => {
    const rows = [
      row({ id: "newest", date: "2026-08-13", amount: "1000" }),
      row({ id: "middle", date: "2026-07-01", amount: "9000" }),
      row({ id: "oldest", date: "2019-07-02", amount: "5000" }),
    ];

    it("leaves the server's order alone for newest first", () => {
      expect(kept(rows, filter({ sort: "newest" }))).toEqual([
        "newest",
        "middle",
        "oldest",
      ]);
    });

    it("reverses it for oldest first", () => {
      expect(kept(rows, filter({ sort: "oldest" }))).toEqual([
        "oldest",
        "middle",
        "newest",
      ]);
    });

    it("ranks by magnitude for largest amount", () => {
      expect(kept(rows, filter({ sort: "largest" }))).toEqual([
        "middle",
        "oldest",
        "newest",
      ]);
    });

    it("keeps equal amounts newest first", () => {
      const tied = [
        row({ id: "recent", amount: "5000" }),
        row({ id: "older", amount: "5000" }),
      ];
      expect(kept(tied, filter({ sort: "largest" }))).toEqual([
        "recent",
        "older",
      ]);
    });

    it("sorts what survived, not what arrived", () => {
      const applied = filter({ sort: "largest", min: "20" });
      expect(kept(rows, applied)).toEqual(["middle", "oldest"]);
    });
  });
});

describe("sortableByAmount", () => {
  it("refuses to rank magnitudes across currencies", () => {
    expect(
      sortableByAmount([row({ currency: "EUR" }), row({ currency: "JPY" })]),
    ).toBe(false);
    expect(
      sortableByAmount([row({ currency: "EUR" }), row({ currency: "EUR" })]),
    ).toBe(true);
    expect(sortableByAmount([])).toBe(true);
  });
});

describe("filterDimensions", () => {
  it("counts nothing when nothing is filtered", () => {
    expect(filterDimensions(NO_FILTER)).toBe(0);
  });

  it("counts a section once however many chips are on inside it", () => {
    const one = filter({ categories: ["home", "transport", "lodging"] });
    expect(filterDimensions(one)).toBe(1);
    // A category and some of another category's children is still one answer
    // to one question.
    expect(
      filterDimensions(
        filter({ categories: ["home"], subcategories: ["transport.fuel"] }),
      ),
    ).toBe(1);
  });

  it("counts each section that is in use", () => {
    const applied = filter({
      when: "month",
      kinds: ["expense"],
      min: "10",
      payers: ["seb"],
      categories: ["home"],
      positions: ["owe"],
      properties: ["receipt"],
      sort: "oldest",
    });
    expect(filterDimensions(applied)).toBe(8);
  });

  it("does not count the search field, which speaks for itself", () => {
    expect(filterDimensions(filter({ query: "hotel" }))).toBe(0);
  });

  it("counts an order that is not the default, since the list is not either", () => {
    expect(filterDimensions(filter({ sort: "newest" }))).toBe(0);
    expect(filterDimensions(filter({ sort: "largest" }))).toBe(1);
  });
});

describe("clearedFilter", () => {
  it("empties the sheet and leaves the search field alone", () => {
    const applied = filter({
      query: "hotel",
      categories: ["home"],
      sort: "oldest",
    });
    expect(clearedFilter(applied)).toEqual({ ...NO_FILTER, query: "hotel" });
  });
});

describe("readFilter and filterParams", () => {
  it("round-trips everything the sheet can set", () => {
    const applied = filter({
      categories: ["home"],
      subcategories: ["transport.fuel"],
      kinds: ["expense", "settlement"],
      query: "lac",
      when: "custom",
      from: "2019-07-02",
      to: "2026-08-24",
      min: "10",
      max: "500",
      payers: ["seb", "padi"],
      positions: ["owe", "flat"],
      properties: ["series", "receipt"],
      sort: "largest",
    });
    expect(readFilter(filterParams(applied))).toEqual(applied);
  });

  it("writes nothing at all for a filter that is off", () => {
    expect(filterParams(NO_FILTER).toString()).toBe("");
  });

  it("produces the same string for the same filter, whatever order it was built in", () => {
    const a = filter({
      kinds: ["settlement", "expense"],
      positions: ["flat", "owe"],
    });
    const b = filter({
      kinds: ["expense", "settlement"],
      positions: ["owe", "flat"],
    });
    expect(filterParams(a).toString()).toBe(filterParams(b).toString());
  });

  it("keeps params it did not put there", () => {
    const base = new URLSearchParams("theme=dark&cat=stale");
    const params = filterParams(filter({ categories: ["home"] }), base);
    expect(params.get("theme")).toBe("dark");
    expect(params.getAll("cat")).toEqual(["home"]);
  });

  it("drops a period, an order or a position it does not recognise", () => {
    const params = new URLSearchParams(
      "when=fortnight&sort=cheapest&pos=maybe&pos=owe&kind=nonsense",
    );
    const applied = readFilter(params);
    expect(applied.when).toBe("any");
    expect(applied.sort).toBe("newest");
    expect(applied.positions).toEqual(["owe"]);
    expect(applied.kinds).toEqual([]);
  });

  it("keeps a category the group has never used, which is a real question", () => {
    expect(readFilter(new URLSearchParams("cat=pets")).categories).toEqual([
      "pets",
    ]);
  });

  it("reads the plain record a Server Component is handed", () => {
    const applied = readFilter({
      cat: ["home", "pets"],
      q: "lac",
      sort: "oldest",
    });
    expect(applied.categories).toEqual(["home", "pets"]);
    expect(applied.query).toBe("lac");
    expect(applied.sort).toBe("oldest");
  });

  it("leaves a custom range out of the URL unless the period is custom", () => {
    const applied = filter({
      when: "month",
      from: "2019-07-02",
      to: "2026-08-24",
    });
    const params = filterParams(applied);
    expect(params.has("from")).toBe(false);
    expect(params.has("to")).toBe(false);
  });
});
