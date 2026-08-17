import { describe, expect, it } from "vitest";
import { toneFor } from "./balance-tone";

describe("toneFor", () => {
  it.each([
    ["1", "positive"],
    ["999999999999999999", "positive"],
    ["-1", "negative"],
    ["-999999999999999999", "negative"],
    ["0", "neutral"],
    ["-0", "neutral"],
  ] as const)("classifies %s as %s", (minorUnits, tone) => {
    expect(toneFor(minorUnits)).toBe(tone);
  });
});
