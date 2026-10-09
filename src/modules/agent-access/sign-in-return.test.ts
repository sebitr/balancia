import { describe, expect, it } from "vitest";
import { signInDestination } from "./sign-in-return";

/**
 * Signing in honours a return address for exactly one screen.
 *
 * Everything else is an open redirect in waiting, so most of this file is the
 * ways somebody would try to turn it into one.
 */

describe("where signing in goes", () => {
  it("is the dashboard when nothing was asked", () => {
    expect(signInDestination(undefined)).toBe("/dashboard");
    expect(signInDestination("")).toBe("/dashboard");
    expect(signInDestination(["/oauth/authorize?a=1"])).toBe("/dashboard");
  });

  it("returns to the consent screen, with the request it was carrying", () => {
    const next =
      "/oauth/authorize?response_type=code&client_id=abc&redirect_uri=https%3A%2F%2Fclaude.ai%2Fapi%2Fmcp%2Fauth_callback&state=s%26t";
    expect(signInDestination(next)).toBe(next);
  });

  it.each([
    ["another host", "//evil.com/oauth/authorize?x=1"],
    ["an absolute URL", "https://evil.com/oauth/authorize?x=1"],
    ["another path", "/dashboard?x=1"],
    ["a path that only starts the same", "/oauth/authorize-evil?x=1"],
    ["a sibling under the same prefix", "/oauth/token?x=1"],
    ["the screen without a request", "/oauth/authorize"],
    ["a backslash the browser reads as a slash", "/oauth/authorize?x=1\\evil"],
    ["a newline", "/oauth/authorize?x=1\nLocation: https://evil.com"],
    ["a tab", "/oauth/authorize?x=\t1"],
    ["a script", "javascript:alert(1)"],
    ["a dot-segment out of the path", "/oauth/authorize/../../groups?x=1"],
  ])("refuses %s", (_name, next) => {
    expect(signInDestination(next)).toBe("/dashboard");
  });

  it("refuses an address too long to be a request anybody wrote", () => {
    expect(signInDestination(`/oauth/authorize?x=${"a".repeat(5000)}`)).toBe(
      "/dashboard",
    );
  });
});
