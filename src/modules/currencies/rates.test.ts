import { describe, expect, it } from "vitest";
import { isQuoteFresh } from "./rates";

const hour = 60 * 60 * 1000;
const now = new Date("2026-08-13T09:00:00.000Z");

function quote(
  overrides: Partial<{
    rateDate: string;
    quotedOn: string;
    fetchedAt: Date;
  }> = {},
) {
  return {
    rateDate: "2026-08-13",
    quotedOn: "2026-08-13",
    rate: "1.1545",
    provider: "frankfurter",
    fetchedAt: now,
    ...overrides,
  };
}

describe("isQuoteFresh", () => {
  it("keeps a quote for a day that is over, however old the row is", () => {
    expect(
      isQuoteFresh(
        quote({
          rateDate: "2026-08-07",
          quotedOn: "2026-08-07",
          fetchedAt: new Date("2026-08-07T16:00:00.000Z"),
        }),
        now,
      ),
    ).toBe(true);
  });

  it("keeps a weekend quote, whose roll-back to Friday is also permanent", () => {
    expect(
      isQuoteFresh(
        quote({
          rateDate: "2026-08-09",
          quotedOn: "2026-08-07",
          fetchedAt: new Date("2026-08-09T10:00:00.000Z"),
        }),
        now,
      ),
    ).toBe(true);
  });

  it("keeps today's quote once today's fixing has been published", () => {
    expect(
      isQuoteFresh(
        quote({
          rateDate: "2026-08-13",
          quotedOn: "2026-08-13",
          fetchedAt: new Date("2026-08-13T00:01:00.000Z"),
        }),
        now,
      ),
    ).toBe(true);
  });

  it("expires today's quote while it still carries yesterday's fixing", () => {
    const stale = quote({
      rateDate: "2026-08-13",
      quotedOn: "2026-08-12",
      fetchedAt: new Date("2026-08-13T08:30:00.000Z"),
    });
    expect(isQuoteFresh(stale, now)).toBe(true);
    expect(isQuoteFresh(stale, new Date(now.getTime() + 2 * hour))).toBe(false);
  });

  it("treats a future expense date as provisional", () => {
    expect(
      isQuoteFresh(
        quote({
          rateDate: "2026-09-01",
          quotedOn: "2026-08-12",
          fetchedAt: new Date(now.getTime() - 2 * hour),
        }),
        now,
      ),
    ).toBe(false);
  });
});
