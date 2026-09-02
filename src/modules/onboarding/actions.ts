"use server";

import { z } from "zod";
import { onboardingSteps } from "@/lib/metrics/metrics";

/**
 * Counting where people get to in the onboarding flow.
 *
 * The flow is a state machine behind one URL, so the page-view counters see
 * one page however many screens somebody crossed, and only some screens end
 * in a Server Action of their own. This records the screens themselves, as a
 * local operational metric — `balancia_onboarding_steps_total`, scraped by
 * whoever runs the instance and never transmitted — so that a change to the
 * flow can be seen to help or hurt rather than believed to.
 *
 * Both values are drawn from closed lists, checked here and not trusted from
 * the client: a counter label is bounded or it is a leak, and this is the one
 * place a browser gets to name one.
 */

const ARRIVALS = ["cold", "personal", "shared"] as const;

const STEPS = [
  "welcome",
  "whichOne",
  "confirm",
  "keepIt",
  "identity",
  "profile",
  "arrival",
  "checklist",
  "firstGroup",
  "startGroup",
  "groupLink",
  /** The flow was left for a group or the dashboard: the funnel's floor. */
  "left",
] as const;

const schema = z.object({
  arrival: z.enum(ARRIVALS),
  step: z.enum(STEPS),
});

export type OnboardingStep = (typeof STEPS)[number];

/**
 * Fire and forget. Never throws and never reports: a counter that could not
 * be incremented is not a thing the person standing on the screen should hear
 * about, and a malformed request is simply not counted.
 */
export async function recordOnboardingStepAction(
  input: unknown,
): Promise<void> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return;
  try {
    onboardingSteps().increment({
      arrival: parsed.data.arrival,
      step: parsed.data.step,
    });
  } catch {
    // Deliberately quiet; see above.
  }
}
