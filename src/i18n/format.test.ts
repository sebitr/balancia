import { describe, expect, it } from "vitest";
import {
  createDateFormatter,
  dateFormatSample,
  DATE_FORMATS,
  formatDate,
  isDateFormat,
  isNumberFormat,
  NUMBER_FORMATS,
  numberFormatSample,
  numberLocale,
  parsePlainDate,
  resolveFormatLocale,
  SAMPLE_DATE,
} from "./format";

/**
 * What the notation preferences have to get right.
 *
 * The two properties that matter are that an explicit choice is *exactly* what
 * it says on the settings screen — the sample in the option is the string the
 * reader will see everywhere — and that `auto` never changes the language of
 * the interface, only its region.
 */

const AUGUST_13 = parsePlainDate("2026-08-13");

describe("resolveFormatLocale", () => {
  it("takes the region the browser asked for", () => {
    expect(resolveFormatLocale("en", "en-GB,en;q=0.9")).toBe("en-GB");
    expect(resolveFormatLocale("fr", "fr-CA,fr;q=0.8")).toBe("fr-CA");
  });

  it("ignores a region belonging to another language", () => {
    // A French interface on an American laptop says nothing about how this
    // person writes French.
    expect(resolveFormatLocale("fr", "en-US,en;q=0.9")).toBe("fr");
  });

  it("prefers the highest-quality tag of the interface language", () => {
    expect(resolveFormatLocale("en", "en-US;q=0.5,en-IN;q=0.9")).toBe("en-IN");
  });

  it("falls back to the bare language", () => {
    expect(resolveFormatLocale("en", null)).toBe("en");
    expect(resolveFormatLocale("en", "en")).toBe("en");
    expect(resolveFormatLocale("en", "*")).toBe("en");
  });

  it("ignores subtags that are not regions", () => {
    expect(resolveFormatLocale("en", "en-latn-x-private")).toBe("en");
  });
});

describe("formatDate", () => {
  const explicit = (dateFormat: "dmy" | "mdy" | "ymd", locale = "en") =>
    formatDate(AUGUST_13, { dateFormat, locale, timeZone: "UTC" });

  it("writes the chosen order, whatever the language", () => {
    expect(explicit("dmy")).toBe("13/08/2026");
    expect(explicit("mdy")).toBe("08/13/2026");
    expect(explicit("ymd")).toBe("2026-08-13");
    expect(explicit("dmy", "fr")).toBe("13/08/2026");
  });

  it("keeps the reader's own notation under auto", () => {
    expect(
      formatDate(AUGUST_13, {
        dateFormat: "auto",
        locale: "en-GB",
        timeZone: "UTC",
      }),
    ).toBe("13 Aug 2026");
    expect(
      formatDate(AUGUST_13, {
        dateFormat: "auto",
        locale: "en-US",
        timeZone: "UTC",
      }),
    ).toBe("Aug 13, 2026");
  });

  it("drops the year for the day-and-month style", () => {
    const dayMonth = (dateFormat: "dmy" | "mdy" | "ymd") =>
      formatDate(AUGUST_13, {
        dateFormat,
        locale: "en",
        timeZone: "UTC",
        style: "dayMonth",
      });
    expect(dayMonth("dmy")).toBe("13/08");
    expect(dayMonth("mdy")).toBe("08/13");
    expect(dayMonth("ymd")).toBe("08-13");
  });

  it("appends the clock only when asked", () => {
    const at = new Date("2026-08-13T14:30:00Z");
    expect(
      formatDate(at, {
        dateFormat: "dmy",
        locale: "en-GB",
        timeZone: "UTC",
        time: "short",
      }),
    ).toBe("13/08/2026, 14:30");
    expect(
      formatDate(at, { dateFormat: "dmy", locale: "en-GB", timeZone: "UTC" }),
    ).toBe("13/08/2026");
  });

  it("resolves an instant in the zone it is read in", () => {
    // Half past nine in the evening in New York is already the 14th in London.
    const at = new Date("2026-08-14T01:30:00Z");
    const inLondon = formatDate(at, {
      dateFormat: "dmy",
      locale: "en",
      timeZone: "Europe/London",
    });
    const inNewYork = formatDate(at, {
      dateFormat: "dmy",
      locale: "en",
      timeZone: "America/New_York",
    });
    expect(inLondon).toBe("14/08/2026");
    expect(inNewYork).toBe("13/08/2026");
  });
});

describe("createDateFormatter", () => {
  const formatter = createDateFormatter({
    dateFormat: "dmy",
    formatLocale: "en",
    timeZone: "America/Los_Angeles",
  });

  it("reads a stored calendar day as the day it was recorded", () => {
    // The whole point of `plain`: west of Greenwich, parsing "2026-08-13" as
    // UTC midnight and rendering it locally would show the 12th.
    expect(formatter.plain("2026-08-13")).toBe("13/08/2026");
  });

  it("resolves an instant in the app's own zone", () => {
    expect(formatter.at("2026-08-14T01:30:00Z")).toBe("13/08/2026");
  });
});

describe("numberLocale", () => {
  it("passes the reader's own locale through under auto", () => {
    expect(numberLocale("auto", "en-IN")).toBe("en-IN");
  });

  it("maps a chosen notation to a locale that writes it", () => {
    const format = (value: number, locale: string) =>
      new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(value);
    expect(format(1234567.89, numberLocale("comma-dot", "fr"))).toBe(
      "1,234,567.89",
    );
    expect(format(1234567.89, numberLocale("dot-comma", "en"))).toBe(
      "1.234.567,89",
    );
    // French groups with a narrow no-break space, which is the correct
    // character rather than the one a keyboard produces.
    expect(format(1234567.89, numberLocale("space-comma", "en"))).toBe(
      "1 234 567,89",
    );
  });
});

describe("the settings samples", () => {
  it("shows every option, and shows them apart", () => {
    const dates = DATE_FORMATS.map((format) => dateFormatSample(format, "en"));
    const numbers = NUMBER_FORMATS.map((format) =>
      numberFormatSample(format, "en"),
    );
    // `auto` may legitimately coincide with the explicit option it resolves
    // to; the explicit ones must never coincide with each other.
    expect(new Set(dates.slice(1)).size).toBe(dates.length - 1);
    expect(new Set(numbers.slice(1)).size).toBe(numbers.length - 1);
  });

  it("uses a day that cannot be mistaken for a month", () => {
    const day = Number(SAMPLE_DATE.slice(8));
    expect(day).toBeGreaterThan(12);
    expect(dateFormatSample("dmy", "en")).not.toBe(
      dateFormatSample("mdy", "en"),
    );
  });

  it("is what the reader will actually see", () => {
    const formatter = createDateFormatter({
      dateFormat: "mdy",
      formatLocale: "en",
      timeZone: "UTC",
    });
    expect(formatter.plain(SAMPLE_DATE)).toBe(dateFormatSample("mdy", "en"));
  });
});

describe("the type guards", () => {
  it("accept exactly what is on offer", () => {
    for (const format of DATE_FORMATS) expect(isDateFormat(format)).toBe(true);
    for (const format of NUMBER_FORMATS) {
      expect(isNumberFormat(format)).toBe(true);
    }
  });

  it("reject anything else, including a stale cookie", () => {
    expect(isDateFormat("d/m/y")).toBe(false);
    expect(isDateFormat(undefined)).toBe(false);
    expect(isNumberFormat("1,234.56")).toBe(false);
    expect(isNumberFormat(null)).toBe(false);
  });
});
