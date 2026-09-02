// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useResendCooldown } from "./use-resend-cooldown";

describe("useResendCooldown", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows a first send straight away", () => {
    const { result } = renderHook(() => useResendCooldown(30));
    expect(result.current.remaining).toBe(0);
  });

  it("counts down from the moment a code goes out, and only then", () => {
    const { result } = renderHook(() => useResendCooldown(30));

    act(() => result.current.start());
    expect(result.current.remaining).toBe(30);

    act(() => vi.advanceTimersByTime(12_000));
    expect(result.current.remaining).toBe(18);

    act(() => vi.advanceTimersByTime(18_000));
    expect(result.current.remaining).toBe(0);
  });

  it("restarts the count on a second send", () => {
    const { result } = renderHook(() => useResendCooldown(30));

    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(25_000));
    act(() => result.current.start());

    expect(result.current.remaining).toBe(30);
  });

  it("never goes below zero, however long the screen stays open", () => {
    const { result } = renderHook(() => useResendCooldown(30));
    act(() => result.current.start());
    act(() => vi.advanceTimersByTime(600_000));
    expect(result.current.remaining).toBe(0);
  });
});
