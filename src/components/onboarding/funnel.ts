"use client";

import { countPageEvent, type PageEvent } from "@/lib/analytics/events";
import type { Arrival, ScreenId } from "./route";

/**
 * The two screens of a cold arrival that mean something happened, and what
 * each one means.
 *
 * `profile` is the screen after the credential: reaching it is having an
 * account. `groupLink` is the end of the other road — no account, a group
 * named, its link in hand. Both are counted for the project's own funnel as
 * well as the operator's, because "how many people who found Balancia ended
 * up with an account" is the one number the public pages exist to move, and
 * no page view can say it: the whole flow is one address.
 *
 * Cold only. Every other arrival came through an invitation, whose address
 * carries a token — the tracker is not on those pages, and the bridge would
 * drop anything sent from one.
 */
const MILESTONES: Partial<Record<ScreenId | "left", PageEvent>> = {
  profile: { name: "signup-completed" },
  groupLink: { name: "guest-group-started" },
};

/** Once each per page load: the back button revisits a screen, not a signup. */
const counted = new Set<string>();

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

  const milestone = arrival === "cold" ? MILESTONES[step] : undefined;
  if (milestone && !counted.has(milestone.name)) {
    counted.add(milestone.name);
    countPageEvent(milestone);
  }

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
