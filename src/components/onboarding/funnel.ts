"use client";

import type { Arrival, ScreenId } from "./route";

/**
 * One count for the operator's funnel, sent and forgotten.
 *
 * `sendBeacon` is the whole point: the last count goes out as the flow leaves
 * for the group, and a request that has to survive the page it was sent from
 * is exactly what a beacon is. Where there is none — jsdom, an old browser —
 * a keep-alive fetch is the next best thing, and either way nothing waits on
 * the answer or hears about a failure. A screen that could not be counted is
 * still a screen.
 */
export function recordOnboardingStep(
  arrival: Arrival,
  step: ScreenId | "left",
): void {
  if (typeof window === "undefined") return;
  const body = JSON.stringify({ arrival, step });
  try {
    if (
      typeof navigator.sendBeacon === "function" &&
      navigator.sendBeacon(
        "/api/onboarding/step",
        new Blob([body], { type: "application/json" }),
      )
    ) {
      return;
    }
    void fetch("/api/onboarding/step", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Deliberately quiet; see above.
  }
}
