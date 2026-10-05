import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/locales";
import {
  isIndexedHere,
  languageAlternates,
  localePaths,
  matchPublicPath,
  OFFICIAL_ORIGIN,
  PUBLIC_PAGES,
  publicPath,
  publicUrl,
  routeFile,
} from "./public-pages";

/**
 * The addresses of the public pages.
 *
 * What a search engine needs from a site in two languages is dull and exact:
 * each page at one address per language, each address naming the others, and
 * nothing readable at two. None of it shows in a browser when it is wrong — a
 * page with a broken `hreflang` pair looks perfect and is quietly filed under
 * the wrong language, or under none. So it is stated here.
 */

const APP = path.join(process.cwd(), "src", "app");

const everyAddress = PUBLIC_PAGES.flatMap((page) =>
  LOCALES.map((locale) => ({ page, locale, path: publicPath(page, locale) })),
);

describe("where the public pages live", () => {
  it("puts English at the root and every other language under its code", () => {
    expect(publicPath("home", "en")).toBe("/");
    expect(publicPath("home", "fr")).toBe("/fr");
    expect(publicPath("splitwise", "en")).toBe("/splitwise-alternative");
    expect(publicPath("splitwise", "fr")).toBe("/fr/alternative-splitwise");
    expect(publicPath("tricount", "en")).toBe("/tricount-alternative");
    expect(publicPath("tricount", "fr")).toBe("/fr/alternative-tricount");
  });

  it("gives every page in every language an address of its own", () => {
    const paths = everyAddress.map((address) => address.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("has a route file behind every one of them", () => {
    // English is a folder per page; every other language is a folder of its
    // own with two files in it. Neither is created by adding a row to the
    // table or a code to `LOCALES` — so a page with no folder is a 404 in
    // English and a page in French, and a language with none has alternate
    // links and sitemap entries pointing at nothing. Both fail here, by name.
    const missing = everyAddress
      .map(({ page, locale }) => path.join(APP, routeFile(page, locale)))
      .filter((file) => !existsSync(file));

    expect(missing).toEqual([]);
  });

  it("serves another language from a file of its own, never from the English one", () => {
    expect(routeFile("home", "en")).toBe("page.tsx");
    expect(routeFile("home", "fr")).toBe("fr/page.tsx");
    expect(routeFile("splitwise", "en")).toBe("splitwise-alternative/page.tsx");
    expect(routeFile("splitwise", "fr")).toBe("fr/[slug]/page.tsx");
  });

  it("keeps a language's folder to its public pages and nothing else", () => {
    // Everything under `/fr` is French by address and open to every crawler.
    // A screen added there because it "is the French one" would be both,
    // which is not something its author would think to check.
    for (const locale of LOCALES) {
      const folder = path.join(APP, locale);
      if (locale === DEFAULT_LOCALE) {
        // `/en` is a spelling of `/`, and redirects to it.
        expect(existsSync(folder), locale).toBe(false);
        continue;
      }
      expect(readdirSync(folder).sort(), locale).toEqual([
        "[slug]",
        "page.tsx",
      ]);
      expect(readdirSync(path.join(folder, "[slug]")), locale).toEqual([
        "page.tsx",
      ]);
    }
  });
});

describe("which page an address names", () => {
  it("reads back every address it hands out", () => {
    for (const { page, locale, path: address } of everyAddress) {
      expect(matchPublicPath(address), address).toEqual({
        page,
        locale,
        path: address,
      });
    }
  });

  it.each([
    ["/en", "/"],
    ["/en/splitwise-alternative", "/splitwise-alternative"],
    ["/fr/splitwise-alternative", "/fr/alternative-splitwise"],
    ["/fr/tricount-alternative", "/fr/alternative-tricount"],
    ["/fr/", "/fr"],
  ])("sends %s on to %s, so no page has two addresses", (asked, canonical) => {
    const route = matchPublicPath(asked);
    expect(route?.path).toBe(canonical);
    expect(route?.path).not.toBe(asked);
  });

  it.each([
    "/dashboard",
    "/sign-in",
    "/register",
    "/groups/f0a42f94-7d0b-4c59-9a0e-3b1d5f1c2a77",
    "/join/g/some-token",
    "/api/health",
    // A French slug with no prefix is not an English address.
    "/alternative-splitwise",
    // A language Balancia does not have is not a prefix.
    "/de",
    "/de/splitwise-alternative",
    "/fr/dashboard",
    "/fr/alternative-splitwise/more",
    "/splitwise-alternative/more",
  ])("leaves %s alone", (pathname) => {
    expect(matchPublicPath(pathname)).toBeNull();
  });
});

describe("the URLs a search engine is given", () => {
  const origin = "https://balancia.app";

  it("writes the English homepage as the bare origin", () => {
    // One spelling. `https://balancia.app` and `https://balancia.app/` are
    // the same page to a browser and two entries to a sitemap.
    expect(publicUrl("home", "en", origin)).toBe("https://balancia.app");
    expect(publicUrl("home", "fr", origin)).toBe("https://balancia.app/fr");
  });

  it("names every language of a page, and a default", () => {
    expect(languageAlternates("splitwise", origin)).toEqual({
      en: "https://balancia.app/splitwise-alternative",
      fr: "https://balancia.app/fr/alternative-splitwise",
      "x-default": "https://balancia.app/splitwise-alternative",
    });
  });

  it("makes the default the address that negotiates, which is English", () => {
    for (const page of PUBLIC_PAGES) {
      expect(languageAlternates(page, origin)["x-default"]).toBe(
        publicUrl(page, DEFAULT_LOCALE, origin),
      );
    }
  });

  it("pairs every address with every other, in both directions", () => {
    // The rule `hreflang` is strictest about: if French names English and
    // English does not name French back, both annotations are ignored. They
    // cannot disagree here because both are read from one map — which is the
    // property worth pinning.
    for (const page of PUBLIC_PAGES) {
      const alternates = languageAlternates(page, origin);
      for (const locale of LOCALES) {
        expect(alternates[locale]).toBe(publicUrl(page, locale, origin));
      }
      expect(Object.keys(alternates).sort()).toEqual(
        [...LOCALES, "x-default"].sort(),
      );
    }
  });

  it("hands the switcher an address for every language", () => {
    expect(localePaths("tricount")).toEqual({
      en: "/tricount-alternative",
      fr: "/fr/alternative-tricount",
    });
  });
});

describe("which instance a page is indexed at", () => {
  const selfHosted = "https://expenses.example.org";

  it("keeps the homepage where it is served", () => {
    // An instance's homepage is its own front door.
    expect(publicUrl("home", "en", selfHosted)).toBe(selfHosted);
    expect(isIndexedHere("home", selfHosted)).toBe(true);
  });

  it("files the comparison pages under the project's own site", () => {
    // Every instance serves them and every copy says the same words. Named
    // as their own canonical URL they would be so many duplicates competing
    // with the original, and with each other.
    for (const page of ["splitwise", "tricount"] as const) {
      expect(
        publicUrl(page, "en", selfHosted).startsWith(OFFICIAL_ORIGIN),
      ).toBe(true);
      expect(isIndexedHere(page, selfHosted)).toBe(false);
      expect(isIndexedHere(page, OFFICIAL_ORIGIN)).toBe(true);
    }
  });

  it("points every alternate of such a page at the same site as its canonical", () => {
    // A canonical on one origin with alternates on another is a
    // contradiction, and a crawler resolves one by ignoring both.
    const urls = Object.values(languageAlternates("splitwise", selfHosted));
    expect(urls.every((url) => url.startsWith(OFFICIAL_ORIGIN))).toBe(true);
  });
});
