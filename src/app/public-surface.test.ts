import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "@/i18n/locales";
import {
  languageAlternates,
  OFFICIAL_ORIGIN,
  PUBLIC_PAGES,
  publicPath,
  publicUrl,
} from "@/lib/public-pages";

/**
 * What a crawler is told about the site, by the three files it asks for
 * before it reads a page: `robots.txt`, `sitemap.xml` and `llms.txt`.
 *
 * Each is generated, each is read by nobody on the team, and each fails
 * silently — a sitemap that omits a page does not error, the page is simply
 * found later or not at all. They are held here to the one table that says
 * what the public pages are, so that adding a page to it is the whole of
 * making that page findable.
 */

const env = vi.hoisted(() => ({ appOrigin: "https://balancia.app" }));
vi.mock("@/lib/env", () => ({ getEnv: () => env }));

const { default: robots } = await import("./robots");
const { default: sitemap } = await import("./sitemap");
const { llmsIndex } = await import("@/components/marketing/llms");

beforeEach(() => {
  env.appOrigin = "https://balancia.app";
});

describe("robots.txt", () => {
  const rules = () => {
    const { rules: group } = robots();
    if (Array.isArray(group)) throw new Error("expected a single group");
    return {
      userAgent: group.userAgent,
      disallow: [group.disallow ?? []].flat(),
    };
  };

  it("closes no public page, in any language", () => {
    // A prefix rule is all `Disallow` is. One added for a new private route
    // that happens to share its opening letters with a public page would
    // take the page out of every index without touching it.
    const { disallow } = rules();
    const closed = PUBLIC_PAGES.flatMap((page) =>
      LOCALES.map((locale) => publicPath(page, locale)),
    ).filter((address) =>
      disallow.some((prefix) => address.startsWith(prefix)),
    );

    expect(closed).toEqual([]);
  });

  it("speaks to every crawler at once, the ones that feed assistants included", () => {
    // A crawler that finds a group addressed to it by name obeys that group
    // and ignores `*`. So the day somebody adds `User-agent: GPTBot` with a
    // single line under it, that crawler stops honouring every `Disallow`
    // above — or, written the other way, is shut out of the pages it was
    // meant to be welcomed to.
    expect(rules().userAgent).toBe("*");
  });

  it("keeps the application itself out", () => {
    const { disallow } = rules();
    for (const prefix of ["/api/", "/groups/", "/dashboard", "/join/"]) {
      expect(disallow).toContain(prefix);
    }
  });

  it("says where the sitemap is", () => {
    expect(robots().sitemap).toBe("https://balancia.app/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("lists every public page once per language", () => {
    const listed = sitemap().map((entry) => entry.url);
    const expected = PUBLIC_PAGES.flatMap((page) =>
      LOCALES.map((locale) => publicUrl(page, locale, OFFICIAL_ORIGIN)),
    );

    expect([...listed].sort()).toEqual([...expected].sort());
  });

  it("tells each entry about the same page in every other language", () => {
    for (const entry of sitemap()) {
      const page = PUBLIC_PAGES.find((candidate) =>
        LOCALES.some(
          (locale) =>
            publicUrl(candidate, locale, OFFICIAL_ORIGIN) === entry.url,
        ),
      );
      expect(page, entry.url).toBeDefined();
      if (!page) continue;
      expect(entry.alternates?.languages, entry.url).toEqual(
        languageAlternates(page, OFFICIAL_ORIGIN),
      );
    }
  });

  it("dates the comparisons by the day they were checked, and nothing by today", () => {
    // A `lastmod` of "now" on every URL is one a crawler learns to ignore.
    const today = new Date().toISOString().slice(0, 10);
    for (const entry of sitemap()) {
      if (entry.lastModified === undefined) continue;
      expect(String(entry.lastModified)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.url).toMatch(/alternative/);
      // Equal only on the very day somebody re-read the other product's
      // pages, which is the one day it should be.
      expect(String(entry.lastModified) <= today).toBe(true);
    }
    expect(
      sitemap().filter((entry) => entry.lastModified !== undefined),
    ).toHaveLength((PUBLIC_PAGES.length - 1) * LOCALES.length);
  });

  it("lists only its own homepage on an instance that is not the project's site", () => {
    // The comparison pages are served there and indexed here. A sitemap may
    // only name URLs on its own host, and these would not be.
    env.appOrigin = "https://expenses.example.org";
    expect(sitemap().map((entry) => entry.url)).toEqual(
      LOCALES.map((locale) =>
        publicUrl("home", locale, "https://expenses.example.org"),
      ),
    );
  });
});

describe("llms.txt", () => {
  it("links every public page in every language", () => {
    const text = llmsIndex(OFFICIAL_ORIGIN);
    const missing = PUBLIC_PAGES.flatMap((page) =>
      LOCALES.map((locale) => publicUrl(page, locale, OFFICIAL_ORIGIN)),
    ).filter((url) => !text.includes(`(${url})`));

    expect(missing).toEqual([]);
  });

  it("opens the way the convention asks: a title, then a summary", () => {
    const [title, blank, summary] = llmsIndex(OFFICIAL_ORIGIN).split("\n");
    expect(title).toBe("# Balancia");
    expect(blank).toBe("");
    expect(summary?.startsWith("> ")).toBe(true);
  });

  it("gives the install commands the homepage gives", () => {
    // The static file this replaced described a three-step install for
    // months after it had become two. Read from the same list, it cannot.
    const text = llmsIndex(OFFICIAL_ORIGIN);
    expect(text).toContain("sh bootstrap.sh");
    expect(text).not.toMatch(/git clone/);
  });

  it("is no longer also a static file, which would shadow the route", () => {
    expect(() =>
      readFileSync(path.join(process.cwd(), "public", "llms.txt")),
    ).toThrow();
  });
});
