import { describe, expect, it } from "vitest";
import {
  nextRunAfter,
  retryDelayMs,
  shouldSkipUnchanged,
  type SkipInput,
} from "./schedule";

const at = (iso: string) => new Date(iso);

describe("nextRunAfter", () => {
  it("adds a day, or a week", () => {
    expect(
      nextRunAfter(at("2026-10-09T03:30:00Z"), "daily").toISOString(),
    ).toBe("2026-10-10T03:30:00.000Z");
    expect(
      nextRunAfter(at("2026-10-09T03:30:00Z"), "weekly").toISOString(),
    ).toBe("2026-10-16T03:30:00.000Z");
  });
});

describe("retryDelayMs", () => {
  const hours = (failures: number) => retryDelayMs(failures) / 3_600_000;

  it("starts at an hour and doubles", () => {
    expect([1, 2, 3, 4].map(hours)).toEqual([1, 2, 4, 8]);
  });

  it("never waits more than a day", () => {
    expect(hours(6)).toBe(24);
    expect(hours(50)).toBe(24);
  });

  it("treats nonsense as the first failure", () => {
    expect(hours(0)).toBe(1);
    expect(hours(-3)).toBe(1);
  });
});

describe("shouldSkipUnchanged", () => {
  const base: SkipInput = {
    trigger: "schedule",
    contentHash: "abc",
    lastContentHash: "abc",
    lastSuccessAt: at("2026-10-08T03:30:00Z"),
    now: at("2026-10-09T03:30:00Z"),
  };

  it("skips a quiet night", () => {
    expect(shouldSkipUnchanged(base)).toBe(true);
  });

  it("writes when anything changed", () => {
    expect(shouldSkipUnchanged({ ...base, contentHash: "def" })).toBe(false);
  });

  it("writes the first time", () => {
    expect(
      shouldSkipUnchanged({
        ...base,
        lastContentHash: null,
        lastSuccessAt: null,
      }),
    ).toBe(false);
  });

  it("always writes when a person asked for it", () => {
    expect(shouldSkipUnchanged({ ...base, trigger: "manual" })).toBe(false);
  });

  it("writes again once the last copy is a week old, changed or not", () => {
    expect(
      shouldSkipUnchanged({
        ...base,
        lastSuccessAt: at("2026-10-01T03:30:00Z"),
      }),
    ).toBe(false);
    expect(
      shouldSkipUnchanged({
        ...base,
        lastSuccessAt: at("2026-10-03T03:31:00Z"),
      }),
    ).toBe(true);
  });
});
