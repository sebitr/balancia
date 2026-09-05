import { afterEach, describe, expect, it, vi } from "vitest";
import {
  describeTimezone,
  detectTimezone,
  filterTimezones,
  isSupportedTimezone,
  normaliseSearchText,
  timezoneCity,
  timezoneOptions,
} from "./timezones";

/**
 * What the picker's list has to get right.
 *
 * Offsets are asserted only for zones that do not observe summer time, so the
 * suite says the same thing in January as in July.
 */

const options = timezoneOptions();

function zones(query: string): string[] {
  return filterTimezones(options, query).map((option) => option.zone);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("timezoneOptions", () => {
  it("lists the zones the runtime itself accepts", () => {
    expect(options.length).toBeGreaterThan(100);
    expect(options.every((option) => isSupportedTimezone(option.zone))).toBe(
      true,
    );
  });

  it("orders by offset, then by name", () => {
    const misordered = options.filter((option, index) => {
      const previous = options[index - 1];
      if (!previous) return false;
      return (
        previous.offsetMinutes > option.offsetMinutes ||
        (previous.offsetMinutes === option.offsetMinutes &&
          previous.label.localeCompare(option.label) > 0)
      );
    });
    expect(misordered).toEqual([]);
  });

  it("spells identifiers the way they are read", () => {
    const newYork = options.find(
      (option) => option.zone === "America/New_York",
    );
    expect(newYork?.label).toBe("America / New York");
  });
});

describe("describeTimezone", () => {
  it("reports the offset in force", () => {
    expect(describeTimezone("UTC").offsetLabel).toBe("GMT+00:00");
    // Neither zone observes summer time, so these hold all year.
    expect(describeTimezone("Asia/Kolkata").offsetLabel).toBe("GMT+05:30");
    expect(describeTimezone("Asia/Tokyo").offsetMinutes).toBe(540);
  });

  it("signs offsets west of the meridian", () => {
    const bogota = describeTimezone("America/Bogota");
    expect(bogota.offsetLabel).toBe("GMT-05:00");
    expect(bogota.offsetMinutes).toBe(-300);
  });

  it("describes a zone the list does not carry", () => {
    // Aliases are not in `Intl.supportedValuesOf`, but a browser may report
    // one as its own zone and the picker still has to show it.
    expect(describeTimezone("Asia/Calcutta").label).toBe("Asia / Calcutta");
  });
});

describe("timezoneCity", () => {
  it("keeps the place and drops the filing", () => {
    expect(timezoneCity("Europe/Zurich")).toBe("Zurich");
    expect(timezoneCity("America/New_York")).toBe("New York");
    // Three segments deep, and it is still the last one that names a place.
    expect(timezoneCity("America/Argentina/Ushuaia")).toBe("Ushuaia");
  });

  it("leaves a zone with no place in it alone", () => {
    expect(timezoneCity("UTC")).toBe("UTC");
  });
});

describe("filterTimezones", () => {
  it("returns everything for an empty query", () => {
    expect(filterTimezones(options, "  ")).toBe(options);
  });

  it("ignores case, underscores and slashes", () => {
    expect(zones("new york")).toContain("America/New_York");
    expect(zones("europe/paris")).toContain("Europe/Paris");
  });

  it("ignores accents the identifiers do not carry", () => {
    expect(zones("são paulo")).toContain("America/Sao_Paulo");
  });

  it("narrows on every term, in any order", () => {
    expect(zones("par eur")).toEqual(["Europe/Paris"]);
  });

  it("matches offsets, written long or short", () => {
    // Which identifier a runtime lists for a given offset is its business
    // (`Asia/Kolkata` on one, `Asia/Calcutta` on another), so the zone to look
    // for comes from the list itself.
    const indian = options.find((option) => option.offsetMinutes === 330);
    expect(zones("gmt+05:30")).toContain(indian?.zone);
    expect(zones("utc+5:30")).toContain(indian?.zone);
    expect(zones("utc+9")).toContain("Asia/Tokyo");
  });

  it("says nothing rather than something wrong", () => {
    expect(zones("atlantis")).toEqual([]);
  });
});

describe("detectTimezone", () => {
  it("names the zone the runtime is running in", () => {
    expect(detectTimezone()).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
  });

  it("declines to guess when the runtime names a zone it will not accept", () => {
    vi.spyOn(Intl.DateTimeFormat.prototype, "resolvedOptions").mockReturnValue({
      timeZone: "Mars/Olympus",
    } as Intl.ResolvedDateTimeFormatOptions);
    expect(detectTimezone()).toBeNull();
  });
});

describe("normaliseSearchText", () => {
  it("collapses the punctuation zone names use", () => {
    expect(normaliseSearchText("  America/Argentina/Buenos_Aires ")).toBe(
      "america argentina buenos aires",
    );
  });
});
