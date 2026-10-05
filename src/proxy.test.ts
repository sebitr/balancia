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

/**
 * The language of a public page is its address.
 *
 * This is the half of that rule nothing else can check: the page files do not
 * know they are also served at `/fr/…`, and the header that tells them is set
 * here and nowhere else. What it is worth is the whole French index — a
 * crawler sends no cookie and no `Accept-Language`, so an address that does
 * not carry its own language is read in English and filed as English, whatever
 * the page would have said to a person.
 */
describe("the language a public page is addressed in", () => {
  const ask = (
    pathname: string,
    init: { headers?: Record<string, string>; method?: string } = {},
  ) =>
    proxy(new NextRequest(new URL(pathname, "https://balancia.example"), init));

  /** What the render is told, as Next carries an overridden request header. */
  const languageFor = (response: Response) =>
    response.headers.get("x-middleware-request-x-balancia-locale");

  it.each([
    ["/", "en"],
    ["/splitwise-alternative", "en"],
    ["/tricount-alternative", "en"],
    ["/fr", "fr"],
    ["/fr/alternative-splitwise", "fr"],
    ["/fr/alternative-tricount", "fr"],
  ])("tells the render that %s is in %s", (pathname, locale) => {
    expect(languageFor(ask(pathname))).toBe(locale);
  });

  it("never rewrites one, because a rewrite is rendered in the wrong language", () => {
    // Serving `/fr` from the file at `/` is the obvious design, and it was
    // the first one. Next runs this function again on the path a rewrite
    // points at: the second pass saw `/`, set the header to English, and the
    // French address was rendered in English — with a response from the
    // first pass that every assertion in this file would have passed. The
    // other languages have route files instead, so one pass is all there is.
    for (const pathname of ["/fr", "/fr/alternative-splitwise"]) {
      expect(ask(pathname).headers.get("x-middleware-rewrite")).toBeNull();
    }
  });

  it("is not moved by what the reader's browser asks for", () => {
    // The same address, the same words, to everybody. A French browser on an
    // English address reads English; the homepage is the one page that sends
    // it elsewhere, and it does that by redirecting, not by answering in
    // French at an English URL.
    const french = { "accept-language": "fr-FR,fr;q=0.9" };
    expect(
      languageFor(ask("/splitwise-alternative", { headers: french })),
    ).toBe("en");
    expect(
      languageFor(ask("/fr", { headers: { "accept-language": "en-GB" } })),
    ).toBe("fr");
  });

  it.each([
    ["/en", "/"],
    ["/en/splitwise-alternative", "/splitwise-alternative"],
    ["/fr/splitwise-alternative", "/fr/alternative-splitwise"],
  ])("moves %s to %s for good, so no page is at two addresses", (asked, to) => {
    const response = ask(`${asked}?utm_source=mail`);
    expect(response.status).toBe(308);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe(to);
    expect(location.searchParams.get("utm_source")).toBe("mail");
  });

  it.each(["/dashboard", "/sign-in", "/groups/abc/expenses", "/api/health"])(
    "says nothing about the language of %s, which is the reader's to choose",
    (pathname) => {
      expect(languageFor(ask(pathname))).toBeNull();
    },
  );

  it("does not let a client send the header itself", () => {
    // Read first by `resolveRequestLocale`, ahead of the reader's own cookie.
    // Left in place on an application route it would let any request choose
    // the language of any screen — harmless, and still not the client's to
    // set. Next forwards only the request headers named in the override list,
    // so a header missing from it is a header the render never sees.
    const response = ask("/dashboard", {
      headers: { "x-balancia-locale": "fr" },
    });
    expect(languageFor(response)).toBeNull();
    expect(
      response.headers.get("x-middleware-override-headers")?.split(","),
    ).not.toContain("x-balancia-locale");
  });

  it("overrules a client that sends it on a public page", () => {
    const response = ask("/", { headers: { "x-balancia-locale": "fr" } });
    expect(languageFor(response)).toBe("en");
  });

  it("still answers a public page with the security headers", () => {
    const response = ask("/fr");
    expect(response.headers.get("content-security-policy")).toContain(
      "default-src 'self'",
    );
    expect(response.headers.get("x-frame-options")).toBe("DENY");
    expect(response.headers.get("cross-origin-resource-policy")).toBe(
      "same-origin",
    );
  });

  it("says so for a Server Action posted from a French page too", () => {
    // The language menu on `/fr` posts its action to `/fr`, and the page it
    // re-renders afterwards has to be the French one.
    const response = ask("/fr", {
      method: "POST",
      headers: { origin: "https://balancia.example", host: "balancia.example" },
    });
    expect(languageFor(response)).toBe("fr");
  });
});
