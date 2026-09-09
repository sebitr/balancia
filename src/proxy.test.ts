import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { shareCardPath } from "@/modules/groups/share-card";

/**
 * Who may pull a Balancia response into their own page.
 *
 * `Cross-Origin-Resource-Policy: same-origin` is the rule, and it is stated at
 * the edge so it covers whatever is added next. The share card is the single
 * exception, and an exception in a security header is exactly the kind of
 * thing that gets widened by accident — so both halves are asserted here: the
 * card is open, and the neighbourhood it sits in is not.
 */

vi.mock("@/lib/env", () => ({
  isWebAssemblyInferenceEnabled: () => false,
}));
vi.mock("@/lib/analytics/umami", () => ({ umamiDestination: () => null }));

const { proxy } = await import("./proxy");

function corpFor(pathname: string): string | null {
  const response = proxy(
    new NextRequest(new URL(pathname, "https://balancia.example")),
  );
  return response.headers.get("cross-origin-resource-policy");
}

describe("the cross-origin resource policy", () => {
  it("opens the share card, which exists to be drawn in someone else's app", () => {
    expect(corpFor(shareCardPath("plane", "blue"))).toBe("cross-origin");
    expect(corpFor(shareCardPath(null, null))).toBe("cross-origin");
  });

  it.each([
    ["/join/g/some-token", "the link the card belongs to"],
    ["/join/og", "the prefix on its own, which serves nothing"],
    ["/join/ogre/blue/plane", "a path that merely starts with the letters"],
    ["/groups/abc/expenses", "a group's own screens"],
    ["/api/receipts/abc", "an attachment"],
    ["/", "the home page"],
  ])("keeps %s closed (%s)", (pathname) => {
    expect(corpFor(pathname)).toBe("same-origin");
  });
});
