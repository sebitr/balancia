/**
 * @vitest-environment jsdom
 *
 * A `.ts` test runs under Node, where there is no `sessionStorage` and no
 * `location` to remember. This one asks for a browser.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readOrigin, rememberOrigin, returnPath } from "./settings-origin";

/**
 * The way back out of settings, and the one thing it must never be: a way off
 * the site. Whatever is in the store is followed by a link without asking, so
 * it is checked on the way out as well as on the way in.
 */

const KEY = "balancia:settings-origin";

/** Puts the test's browser on `path`, as a press of the avatar would find it. */
function standOn(path: string) {
  window.history.replaceState(null, "", path);
}

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  standOn("/");
});

describe("the remembered origin", () => {
  it("is the screen the avatar was pressed on", () => {
    standOn("/groups/g1");
    rememberOrigin();

    expect(readOrigin()).toBe("/groups/g1");
  });

  it("keeps the list's filters, as the address stood when it was left", () => {
    standOn("/groups/g1/expenses?cat=lodging&q=h%C3%B4tel");
    rememberOrigin();

    expect(readOrigin()).toBe("/groups/g1/expenses?cat=lodging&q=h%C3%B4tel");
  });

  it("is not spent by reading it, so the hub can be come back to", () => {
    standOn("/groups/g1");
    rememberOrigin();

    expect(readOrigin()).toBe("/groups/g1");
    // Back from Notifications, then the ✕: the same place both times.
    expect(readOrigin()).toBe("/groups/g1");
  });

  it("holds the latest visit's", () => {
    standOn("/groups/g1");
    rememberOrigin();
    standOn("/notifications");
    rememberOrigin();

    expect(readOrigin()).toBe("/notifications");
  });

  it("is nothing at all when settings was not opened from the app", () => {
    // A link in an email, a new tab: nowhere to go back to.
    expect(readOrigin()).toBeNull();
  });

  it("is never a screen inside settings", () => {
    standOn("/settings/notifications");
    rememberOrigin();

    expect(readOrigin()).toBeNull();
  });

  it("follows nothing it did not write", () => {
    for (const planted of [
      "https://evil.example/groups/g1",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "javascript:alert(1)",
    ]) {
      sessionStorage.setItem(KEY, planted);
      expect(readOrigin(), planted).toBeNull();
    }
  });

  it("goes quiet when the store itself refuses", () => {
    // Safari in private browsing, or a full quota: the ✕ goes to the
    // dashboard, as it always did, rather than the screen failing.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });

    standOn("/groups/g1");
    expect(() => rememberOrigin()).not.toThrow();
    expect(readOrigin()).toBeNull();

    setItem.mockRestore();
    getItem.mockRestore();
  });
});

describe("a path settings may close to", () => {
  it("is a path of this app's own", () => {
    for (const path of [
      "/dashboard",
      "/groups/7f3c1d2e-4b5a-4c6d-8e9f-0a1b2c3d4e5f",
      "/groups/g1/expenses?cat=lodging&when=custom&from=2026-01-01",
      "/notifications",
      "/groups/g1/settings",
    ]) {
      expect(returnPath(path), path).toBe(path);
    }
  });

  it("is never another site", () => {
    for (const path of [
      "https://evil.example",
      "http://evil.example/dashboard",
      "//evil.example",
      "//evil.example/dashboard",
      "///evil.example",
      // A browser reads a backslash in a URL as a slash.
      "/\\evil.example",
      "\\\\evil.example",
      // The URL parser drops tabs and newlines before reading the rest.
      "/\t/evil.example",
      "/\n/evil.example",
      "/\r/evil.example",
      // Dot segments the parser folds into a host-shaped path.
      "/..//evil.example",
      "/.//evil.example",
    ]) {
      expect(returnPath(path), JSON.stringify(path)).toBeNull();
    }
  });

  it("is never a scheme", () => {
    for (const path of [
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "mailto:someone@example.com",
    ]) {
      expect(returnPath(path), path).toBeNull();
    }
  });

  it("is never malformed", () => {
    for (const value of [
      "",
      "dashboard",
      "groups/g1",
      " /dashboard",
      "/dash board",
      "/dashboard\u0000",
      "/dashboard\u007f",
      null,
      undefined,
      42,
      { pathname: "/dashboard" },
    ]) {
      expect(returnPath(value), JSON.stringify(value)).toBeNull();
    }
  });

  it("is never settings itself", () => {
    expect(returnPath("/settings")).toBeNull();
    expect(returnPath("/settings/money")).toBeNull();
    expect(returnPath("/settings?x=1")).toBeNull();
  });
});
