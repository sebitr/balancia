import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useDetectedTimezone } from "./use-detected-timezone";
import { isSupportedTimezone } from "@/lib/timezones";

/**
 * Group creation preselects the zone the person creating it is in, which only
 * works if the hook answers with the browser's own zone once there is one.
 */

describe("useDetectedTimezone", () => {
  it("reports the zone the browser is in", () => {
    const { result } = renderHook(() => useDetectedTimezone());

    expect(result.current).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    );
    expect(isSupportedTimezone(result.current ?? "")).toBe(true);
  });
});
