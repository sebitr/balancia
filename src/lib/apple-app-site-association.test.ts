import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { resetEnvCache } from "@/lib/env";
import { joinLinkUrl } from "@/lib/security/join-link";
import {
  APPLE_APP_SITE_ASSOCIATION,
  IOS_APP_ID,
} from "./apple-app-site-association";

/**
 * The Universal Link claim has to keep matching the links Balancia mints.
 *
 * This is the failure this file exists to prevent: move where a join link
 * points, leave the claim behind, and *nothing reports it*. The web keeps
 * working, the app keeps building, the entitlement stays valid, and the only
 * symptom is that invitations quietly stop opening the app. There is no error
 * on the device and none in the developer portal. So the claim is checked
 * against the real URL builder rather than against a copy of it.
 */

const ORIGIN = "https://balancia.example.com";
// 43 base64url characters, the shape `generateToken` produces.
const TOKEN = "Ky9nQ2p3TnZ4UjhmTDRhSDdiVzJlUzVtVDFjWDBkWmc";

beforeEach(() => {
  process.env.APP_URL = ORIGIN;
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  resetEnvCache();
});

const components = APPLE_APP_SITE_ASSOCIATION.applinks.details[0]!.components;

/**
 * Apple's pattern language, as far as this file uses it: `*` stands for any
 * run of characters — `/` included — and `?` for exactly one. Matching is
 * first-wins, so an `exclude` only bites when it precedes the include that
 * would otherwise have caught the path.
 */
function claims(pathname: string): boolean {
  for (const component of components) {
    const pattern = new RegExp(
      `^${component["/"]
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".")}$`,
    );
    if (pattern.test(pathname)) return !component.exclude;
  }
  // Nothing matched: the app is not asked to open it.
  return false;
}

function pathOf(url: string): string {
  return new URL(url).pathname;
}

describe("the App ID", () => {
  it("is a ten-character prefix joined to the bundle ID", () => {
    // A malformed App ID fails exactly as silently as a wrong one.
    expect(IOS_APP_ID).toMatch(/^[A-Z0-9]{10}\.[A-Za-z0-9.-]+$/);
  });

  it("is the same identity for links and for passkeys", () => {
    expect(APPLE_APP_SITE_ASSOCIATION.webcredentials.apps).toEqual([
      IOS_APP_ID,
    ]);
  });
});

describe("the links Balancia mints", () => {
  it("claims the group-wide join link", () => {
    // The real builder, so moving it moves this test.
    expect(claims(pathOf(joinLinkUrl(TOKEN)))).toBe(true);
  });

  it("claims a per-person invitation", () => {
    expect(claims(`/join/${TOKEN}`)).toBe(true);
  });

  it("still mints both shapes under /join", () => {
    // The invitation URL is built inline at its two call sites rather than
    // behind a helper this test could import, so it is read from the source.
    // A move to some other prefix has to fail here, not on a device.
    const sources = [
      "src/modules/groups/actions.ts",
      "src/app/api/groups/[groupId]/participants/[participantId]/invitation/route.ts",
    ];
    for (const file of sources) {
      const text = readFileSync(path.join(process.cwd(), file), "utf8");
      expect(text, `${file} no longer mints a /join/ URL`).toContain(
        "appOrigin}/join/",
      );
    }
  });
});

describe("what the app must not take over", () => {
  it.each([
    ["/join/start", "the group flow's own continuation page"],
    ["/join/error", "the dead-link screen"],
    ["/invite", "where a spent invitation lands, on a cookie the app lacks"],
    ["/api/groups/abc/join-link", "the mobile API"],
    ["/api/auth/apple/callback", "the Sign in with Apple callback"],
    ["/sign-in", "credential entry"],
    ["/register/password", "registration"],
    ["/reset-password", "password recovery"],
    ["/verify-email", "a mailed verification link"],
    ["/confirm-email", "a mailed confirmation link"],
    ["/groups/abc", "an ordinary group page"],
    ["/", "the marketing homepage"],
  ])("leaves %s to the browser (%s)", (pathname) => {
    expect(claims(pathname)).toBe(false);
  });
});

describe("component order", () => {
  it("puts every /join exclusion ahead of the /join wildcard", () => {
    // First match wins. `/join/*` covers `/join/start` and `/join/error`, so
    // reordering these silently hands both screens to an app that has neither.
    const wildcard = components.findIndex((c) => c["/"] === "/join/*");
    expect(wildcard).toBeGreaterThan(-1);
    for (const [index, component] of components.entries()) {
      if (component.exclude && component["/"].startsWith("/join/")) {
        expect(index, `${component["/"]} must precede /join/*`).toBeLessThan(
          wildcard,
        );
      }
    }
  });
});
