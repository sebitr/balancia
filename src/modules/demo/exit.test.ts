import { describe, expect, it } from "vitest";
import { signOutDestination } from "./exit";

describe("signOutDestination", () => {
  it("sends a real instance to its homepage", () => {
    expect(signOutDestination({ DEMO_MODE: false })).toBe("/");
  });

  it("ignores DEMO_EXIT_URL when the instance is not a demo", () => {
    // Otherwise an operator who set both — or copied one .env from the other —
    // would find their own users leaving for somebody else's site.
    expect(
      signOutDestination({
        DEMO_MODE: false,
        DEMO_EXIT_URL: "https://balancia.app",
      }),
    ).toBe("/");
  });

  it("sends a demo visitor to the real site", () => {
    expect(
      signOutDestination({
        DEMO_MODE: true,
        DEMO_EXIT_URL: "https://balancia.app",
      }),
    ).toBe("https://balancia.app");
  });

  it("keeps a demo with nowhere to send people on the sign-in screen", () => {
    // Not "/": that redirects to /sign-in anyway, so going there directly is
    // the same destination without the extra round trip.
    expect(signOutDestination({ DEMO_MODE: true })).toBe("/sign-in");
  });
});
