import { describe, expect, it } from "vitest";
import {
  nextScreen,
  previousScreen,
  progressOf,
  routeFor,
  STEP_LABEL_KEYS,
  type Arrival,
  type Intent,
  type OnboardingRouteState,
  type ScreenId,
} from "./route";

/**
 * The six routes, spelled out.
 *
 * The handoff lists them as a table and the prototype got two of them wrong by
 * maintaining the order by hand, so the table is the test: if a screen moves,
 * this says which route it moved in rather than leaving somebody to click
 * through all six.
 */

const state = (
  arrival: Arrival,
  intent: Intent,
  isNewMember = false,
  signedIn = false,
  setupComplete = false,
): OnboardingRouteState => ({
  arrival,
  intent,
  isNewMember,
  signedIn,
  setupComplete,
});

describe("routeFor", () => {
  it("asks a personal invitation for an address, then a name", () => {
    expect(routeFor(state("personal", "account"))).toEqual([
      "welcome",
      "identity",
      "profile",
      "arrival",
      "checklist",
    ]);
  });

  it("skips the profile screen for somebody who already has an account", () => {
    expect(routeFor(state("personal", "signin"))).toEqual([
      "welcome",
      "identity",
      "arrival",
      "checklist",
    ]);
  });

  it("asks a guest for a name and nothing else", () => {
    expect(routeFor(state("personal", "guest"))).toEqual([
      "welcome",
      "profile",
      "arrival",
      "checklist",
    ]);
  });

  it("asks a shared link who this is before what to keep", () => {
    expect(routeFor(state("shared", "account"))).toEqual([
      "welcome",
      "whichOne",
      "confirm",
      "keepIt",
      "identity",
      "arrival",
      "checklist",
    ]);
  });

  it("sends somebody who was not on the list to type their own name", () => {
    const route = routeFor(state("shared", "account", true));
    expect(route).toEqual([
      "welcome",
      "whichOne",
      "profile",
      "keepIt",
      "identity",
      "arrival",
      "checklist",
    ]);
    expect(route).not.toContain("confirm");
  });

  it("drops the account screen when a shared link ends in a guest", () => {
    expect(routeFor(state("shared", "guest"))).not.toContain("identity");
  });

  it("asks a signed-in reader which name is theirs and nothing else", () => {
    // The account question and the credential that answers it are both behind
    // them, so claiming the name is the last thing they do.
    expect(routeFor(state("shared", "signin", false, true))).toEqual([
      "welcome",
      "whichOne",
      "confirm",
      "arrival",
      "checklist",
    ]);
  });

  it("sends a signed-in reader who was not on the list to type a name", () => {
    expect(routeFor(state("shared", "signin", true, true))).toEqual([
      "welcome",
      "whichOne",
      "profile",
      "arrival",
      "checklist",
    ]);
  });

  it("never asks a signed-in reader to keep it or to prove anything", () => {
    for (const intent of ["account", "signin", "guest"] as Intent[]) {
      for (const isNewMember of [false, true]) {
        const route = routeFor(state("shared", intent, isNewMember, true));
        expect(route).not.toContain("keepIt");
        expect(route).not.toContain("identity");
      }
    }
  });

  it("gives a cold arrival no group screens and no guest anything", () => {
    const route = routeFor(state("cold", "account"));
    expect(route).toEqual(["welcome", "identity", "profile", "firstGroup"]);
    expect(route).not.toContain("arrival");
    expect(route).not.toContain("checklist");
  });

  it("drops the checklist when there is nothing left on it", () => {
    // Only somebody who arrived signed in can be in this state, and for them
    // the arrival screen is the end: its primary goes straight to the group.
    const route = routeFor(state("shared", "signin", false, true, true));
    expect(route).toEqual(["welcome", "whichOne", "confirm", "arrival"]);
    expect(nextScreen(route, "arrival")).toBeNull();
  });

  it("drops it from a personal invitation on the same terms", () => {
    expect(routeFor(state("personal", "signin", false, false, true))).toEqual([
      "welcome",
      "identity",
      "arrival",
    ]);
  });

  it("leaves a cold arrival alone, having no checklist to drop", () => {
    expect(routeFor(state("cold", "account", false, false, true))).toEqual([
      "welcome",
      "identity",
      "profile",
      "firstGroup",
    ]);
  });

  it("never lands the same screen twice in one route", () => {
    const arrivals: Arrival[] = ["personal", "shared", "cold"];
    const intents: Intent[] = ["account", "signin", "guest"];
    for (const arrival of arrivals) {
      for (const intent of intents) {
        for (const isNewMember of [false, true]) {
          for (const signedIn of [false, true]) {
            for (const setupComplete of [false, true]) {
              const route = routeFor(
                state(arrival, intent, isNewMember, signedIn, setupComplete),
              );
              expect(new Set(route).size).toBe(route.length);
              // Whatever else it drops, a route always has somewhere to land.
              expect(route.length).toBeGreaterThan(1);
            }
          }
        }
      }
    }
  });
});

describe("previousScreen and nextScreen", () => {
  it("returns a screen to the place it was reached from, not to a fixed one", () => {
    // `identity` sits after `keepIt` on a shared link and after `welcome` on a
    // personal one. A history stack would get this right only by accident.
    expect(
      previousScreen(routeFor(state("shared", "account")), "identity"),
    ).toBe("keepIt");
    expect(
      previousScreen(routeFor(state("personal", "account")), "identity"),
    ).toBe("welcome");
  });

  it("has nothing before the first screen or after the last", () => {
    const route = routeFor(state("cold", "account"));
    expect(previousScreen(route, "welcome")).toBeNull();
    expect(nextScreen(route, "firstGroup")).toBeNull();
  });

  it("walks the whole route forwards and back again", () => {
    const route = routeFor(state("shared", "account"));
    const walked: ScreenId[] = ["welcome"];
    for (;;) {
      const next = nextScreen(route, walked[walked.length - 1]);
      if (!next) break;
      walked.push(next);
    }
    expect(walked).toEqual([...route]);
  });
});

describe("progressOf", () => {
  it("runs from nothing to full across whichever route this is", () => {
    for (const arrival of ["personal", "shared", "cold"] as Arrival[]) {
      const route = routeFor(state(arrival, "account"));
      expect(progressOf(route, route[0])).toBe(0);
      expect(progressOf(route, route[route.length - 1])).toBe(1);
    }
  });

  it("reaches full on the arrival screen when that is where a route ends", () => {
    const route = routeFor(state("shared", "signin", false, true, true));
    expect(progressOf(route, "arrival")).toBe(1);
  });

  it("runs to full on the shorter route a signed-in reader takes", () => {
    const route = routeFor(state("shared", "signin", false, true));
    expect(progressOf(route, "welcome")).toBe(0);
    expect(progressOf(route, "checklist")).toBe(1);
  });

  it("only ever moves forwards", () => {
    const route = routeFor(state("shared", "account"));
    const measured = route.map((screen) => progressOf(route, screen));
    expect(measured).toEqual([...measured].sort((a, b) => a - b));
  });
});

describe("STEP_LABEL_KEYS", () => {
  it("names every screen any route can reach", () => {
    const reachable = new Set<ScreenId>();
    for (const arrival of ["personal", "shared", "cold"] as Arrival[]) {
      for (const intent of ["account", "signin", "guest"] as Intent[]) {
        for (const isNewMember of [false, true]) {
          for (const signedIn of [false, true]) {
            for (const setupComplete of [false, true]) {
              const route = routeFor(
                state(arrival, intent, isNewMember, signedIn, setupComplete),
              );
              for (const screen of route) reachable.add(screen);
            }
          }
        }
      }
    }
    for (const screen of reachable) {
      expect(STEP_LABEL_KEYS[screen]).toBeTruthy();
    }
  });
});
