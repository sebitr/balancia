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
 * The routes, spelled out.
 *
 * The handoff lists them as a table and the prototype got two of them wrong by
 * maintaining the order by hand, so the table is the test: if a screen moves,
 * this says which route it moved in rather than leaving somebody to click
 * through all of them.
 */

const state = (
  arrival: Arrival,
  intent: Intent,
  signedIn = false,
  setupComplete = false,
): OnboardingRouteState => ({
  arrival,
  intent,
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

  it("opens a shared link on the list, and lets a guest in from the next screen", () => {
    // Two screens, then the group itself: the list, and how to come in. The
    // welcome, "Is this you?", the arrival screen and the checklist that used
    // to stand between them and the group are all gone.
    expect(routeFor(state("shared", "guest"))).toEqual(["whichOne", "keepIt"]);
  });

  it("adds the credential, and only that, for an account on a shared link", () => {
    expect(routeFor(state("shared", "account"))).toEqual([
      "whichOne",
      "keepIt",
      "identity",
    ]);
    expect(routeFor(state("shared", "signin"))).toEqual([
      "whichOne",
      "keepIt",
      "identity",
    ]);
  });

  it("asks a signed-in reader which name is theirs, and to say yes", () => {
    // The account question and the credential that answers it are both behind
    // them, so saying yes to the name is the last thing they do.
    expect(routeFor(state("shared", "signin", true))).toEqual([
      "whichOne",
      "keepIt",
    ]);
  });

  it("never asks a signed-in reader to prove anything", () => {
    for (const intent of ["account", "signin", "guest"] as Intent[]) {
      expect(routeFor(state("shared", intent, true))).not.toContain("identity");
    }
  });

  it("never puts a receipt between a shared link and its group", () => {
    for (const intent of ["account", "signin", "guest"] as Intent[]) {
      for (const signedIn of [false, true]) {
        const route = routeFor(state("shared", intent, signedIn));
        expect(route).not.toContain("welcome");
        expect(route).not.toContain("arrival");
        expect(route).not.toContain("checklist");
      }
    }
  });

  it("gives a cold arrival no group screens and no guest anything", () => {
    const route = routeFor(state("cold", "account"));
    expect(route).toEqual(["welcome", "identity", "profile", "firstGroup"]);
    expect(route).not.toContain("arrival");
    expect(route).not.toContain("checklist");
  });

  it("ends a cold sign-in on the credential, never on a name or a first group", () => {
    // The account exists and its groups are on the dashboard. Running the
    // profile screen here renamed a returning member with whatever they typed
    // into its empty field, and the first-group screen then told them they
    // had no groups.
    const route = routeFor(state("cold", "signin"));
    expect(route).toEqual(["welcome", "identity"]);
    expect(nextScreen(route, "identity")).toBeNull();
  });

  it("drops the checklist from a personal invitation when nothing is left on it", () => {
    expect(routeFor(state("personal", "signin", false, true))).toEqual([
      "welcome",
      "identity",
      "arrival",
    ]);
  });

  it("lets a cold arrival start a group with no account, and leave with its link", () => {
    // The third door on the cold welcome: the same guest an invitation
    // mints, arriving through a group of their own. No credential screen,
    // no profile screen — a name is asked with the group's.
    const route = routeFor(state("cold", "guest"));
    expect(route).toEqual(["welcome", "startGroup", "groupLink"]);
    expect(route).not.toContain("identity");
    expect(route).not.toContain("firstGroup");
  });

  it("keeps the way back open on the last screen of a cold sign-in", () => {
    // Nothing is committed on the identity screen until the credential
    // lands, so unlike every other route's last screen it is not an ending.
    const route = routeFor(state("cold", "signin"));
    expect(previousScreen(route, "identity")).toBe("welcome");
  });

  it("leaves a cold arrival alone, having no checklist to drop", () => {
    expect(routeFor(state("cold", "account", false, true))).toEqual([
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
        for (const signedIn of [false, true]) {
          for (const setupComplete of [false, true]) {
            const route = routeFor(
              state(arrival, intent, signedIn, setupComplete),
            );
            expect(new Set(route).size).toBe(route.length);
            // Whatever else it drops, a route always has somewhere to land.
            expect(route.length).toBeGreaterThan(1);
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
    expect(previousScreen(routeFor(state("shared", "guest")), "whichOne")).toBe(
      null,
    );
  });

  it("walks the whole route forwards and back again", () => {
    const route = routeFor(state("personal", "account"));
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
    const route = routeFor(state("personal", "signin", false, true));
    expect(progressOf(route, "arrival")).toBe(1);
  });

  it("only ever moves forwards", () => {
    const route = routeFor(state("personal", "account"));
    const measured = route.map((screen) => progressOf(route, screen));
    expect(measured).toEqual([...measured].sort((a, b) => a - b));
  });
});

describe("STEP_LABEL_KEYS", () => {
  it("names every screen any route can reach", () => {
    const reachable = new Set<ScreenId>();
    for (const arrival of ["personal", "shared", "cold"] as Arrival[]) {
      for (const intent of ["account", "signin", "guest"] as Intent[]) {
        for (const signedIn of [false, true]) {
          for (const setupComplete of [false, true]) {
            const route = routeFor(
              state(arrival, intent, signedIn, setupComplete),
            );
            for (const screen of route) reachable.add(screen);
          }
        }
      }
    }
    for (const screen of reachable) {
      expect(STEP_LABEL_KEYS[screen]).toBeTruthy();
    }
  });
});
