import { describe, expect, it } from "vitest";
import { shortMonthWithYear } from "./month-label";

describe("shortMonthWithYear", () => {
  const date = new Date(Date.UTC(2025, 10, 1));

  it("never carries an apostrophe before the year", () => {
    for (const locale of ["en-US", "en-GB", "fr-FR", "de-DE"]) {
      expect(shortMonthWithYear(locale)(date)).not.toMatch(/['’ʼ]/);
    }
  });

  it("gives the same text for the same date and locale", () => {
    expect(shortMonthWithYear("en-US")(date)).toBe("Nov 25");
    expect(shortMonthWithYear("en-US")(date)).toBe(
      shortMonthWithYear("en-US")(date),
    );
  });
});
