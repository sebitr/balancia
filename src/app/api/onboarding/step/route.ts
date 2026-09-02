import { NextResponse } from "next/server";
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
 * A route handler rather than a Server Action, and reached by `sendBeacon`:
 * the last count is sent as the flow leaves for the group, and an action
 * still in flight when the router moves rejects with a page error the reader
 * can see. A beacon outlives the page and answers to nobody.
 *
 * Both values are drawn from closed lists, checked here and not trusted from
 * the client: a counter label is bounded or it is a leak, and this is the one
 * place a browser gets to name one.
 */

export const ARRIVALS = ["cold", "personal", "shared"] as const;

export const STEPS = [
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

export async function POST(request: Request): Promise<NextResponse> {
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // Not JSON. Not counted, and not worth a sentence: nobody is listening.
  }
  const parsed = schema.safeParse(body);
  if (parsed.success) {
    onboardingSteps().increment({
      arrival: parsed.data.arrival,
      step: parsed.data.step,
    });
  }
  // 204 either way. A malformed request is simply not counted; answering it
  // differently would let a caller probe which values are on the list.
  return new NextResponse(null, {
    status: 204,
    headers: { "Cache-Control": "no-store" },
  });
}
