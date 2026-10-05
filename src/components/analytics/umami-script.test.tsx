import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pageBridge } from "@/lib/analytics/bridge";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/locales";
import { PUBLIC_PAGES, routeFile } from "@/lib/public-pages";

const headers = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers }));

// The component asks one question — "should the public pages be counted?" —
// and `umami.test.ts` is where that question's own rules are tested. Mocked
// here so these assertions are about the tag, and so they keep working once
// the website ID is filled in.
const publicPageAnalytics = vi.hoisted(() => vi.fn());
vi.mock("@/lib/analytics/umami", () => ({ publicPageAnalytics }));

const { UmamiScript } = await import("./umami-script");

/**
 * Where the tracker is allowed to be, and what it is allowed to send.
 *
 * Balancia's URLs name groups and expenses
 * (`/groups/f0a42f94-…/expenses/9f63…`), a page view carries the URL, and no
 * tracker setting makes that safe to hand to a third party. So the script
 * goes on the pages that have no identifier and no session behind them, and
 * the first tests below are the ones that keep it there.
 *
 * That is half of the boundary and was once taken for all of it. A script
 * loaded on `/sign-in` is still running after the reader signs in, and it
 * counted every screen they opened next. The other half is the hook the tag
 * names in `data-before-send`, which refuses any address not on its list at
 * the moment of sending; `lib/analytics/bridge.test.ts` holds that. Both
 * halves stay: where the tag is decides who loads a third-party script at
 * all, and the hook decides what a loaded one may say.
 */

const SRC = path.join(process.cwd(), "src");

/** The public pages' shell, which mounts the tracker for all of them. */
const SHELL = path.join("src", "components", "marketing", "shell.tsx");

/** Where the tracker itself may be imported. */
const TRACKER_MOUNTS = [
  SHELL,
  // /sign-in, /forgot-password, /reset-password, /register/password and
  // /register/done.
  path.join("src", "app", "(auth)", "layout.tsx"),
  // /register, which sits outside that group to draw its own shell.
  path.join("src", "app", "register", "layout.tsx"),
];

/** The route files behind a public page, by the table that gives it its addresses. */
const routeFiles = (page: (typeof PUBLIC_PAGES)[number]) =>
  LOCALES.map((locale) => path.join("src", "app", routeFile(page, locale)));

/**
 * What may stand in the shell: the homepage, and the component the
 * comparison pages hand their whole page to.
 */
const SHELL_USERS = [
  path.join("src", "app", "page.tsx"),
  path.join("src", "components", "marketing", "comparison-page.tsx"),
];

/** The one file every language but English renders the comparisons through. */
const COMPARISON_ROUTE = path.join(
  "src",
  "components",
  "marketing",
  "comparison-route.tsx",
);

/** The routes behind the comparison pages, in every language. */
const COMPARISON_PAGES = [
  ...new Set(
    PUBLIC_PAGES.filter((page) => page !== "home").flatMap(routeFiles),
  ),
];
const inEnglish = (file: string) =>
  !LOCALES.some(
    (locale) =>
      locale !== DEFAULT_LOCALE &&
      file.startsWith(path.join("src", "app", locale) + path.sep),
  );

/** Every file under src/ that imports `module`, repository-relative. */
function importers(module: string): string[] {
  const pattern = new RegExp(`from ["']${module.replace(/[/]/g, "\\/")}["']`);
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        /\.tsx?$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name)
      ) {
        if (pattern.test(readFileSync(full, "utf8"))) {
          found.push(path.relative(process.cwd(), full));
        }
      }
    }
  };
  walk(SRC);
  return found.sort();
}

describe("where the tracker is mounted", () => {
  /**
   * The regression this exists for is a one-line diff: moving `<UmamiScript />`
   * into `src/app/layout.tsx` because that is where a script tag usually goes.
   * It would work, nothing would look wrong, and every group and expense
   * identifier in the application would start arriving at the analytics host.
   */
  it("is on the public pages and nowhere else", () => {
    expect(
      importers("@/components/analytics/umami-script"),
      "the tracker must not reach a page whose URL names a group or an " +
        "expense; see the comment in src/lib/analytics/umami.ts",
    ).toEqual([...TRACKER_MOUNTS].sort());
  });

  /**
   * The same regression, one step removed. The tracker reaches the public
   * pages through their shell, so wrapping any other screen in that shell —
   * a new page that wants the plum header — would put the tracker on it
   * without the file ever mentioning analytics.
   */
  it("reaches them through a shell only the public pages stand in", () => {
    expect(
      importers("@/components/marketing/shell").filter(
        // The shell also exports the buttons and marks the pages are built
        // from; what matters is who renders the shell itself.
        (file) => /<MarketingShell\b/.test(readFileSync(file, "utf8")),
      ),
      "MarketingShell mounts the page counter; it may only wrap a page " +
        "listed in src/lib/public-pages.ts",
    ).toEqual([...SHELL_USERS].sort());

    // The comparison component is rendered by the English pages directly,
    // and by every other language's through one shared route.
    expect(importers("@/components/marketing/comparison-page")).toEqual(
      [...COMPARISON_PAGES.filter(inEnglish), COMPARISON_ROUTE].sort(),
    );
    expect(importers("@/components/marketing/comparison-route")).toEqual(
      COMPARISON_PAGES.filter((file) => !inEnglish(file)).sort(),
    );

    // The homepage in another language is the homepage's own module,
    // re-exported by the one route that serves it there.
    expect(importers("../page")).toEqual(
      routeFiles("home")
        .filter((file) => file !== path.join("src", "app", "page.tsx"))
        .sort(),
    );
  });

  it("is not in the root layout, which wraps the whole application", () => {
    const root = readFileSync(path.join(SRC, "app", "layout.tsx"), "utf8");
    expect(root).not.toMatch(/umami/i);
  });

  /**
   * The landing page tells the reader this instance "includes no analytics or
   * telemetry". On an instance that has configured Umami, that sentence would
   * be printed by a page which is at that moment loading an analytics script.
   * So the claim is conditional, and this fails if someone straightens it back
   * out into an unconditional one.
   */
  it("leaves the landing page's privacy claim conditional on the setting", () => {
    const landing = readFileSync(path.join(SRC, "app", "page.tsx"), "utf8");
    // The self-hosting section prints one of two paragraphs, and which one
    // has to be decided by the same question the tracker asks.
    expect(landing).toMatch(/selfHosting\.bodyAnalytics/);
    expect(
      landing,
      "src/app/page.tsx describes this instance's telemetry; it must call " +
        "publicPageAnalytics() so the description is the true one",
    ).toMatch(/publicPageAnalytics\(\)/);
  });
});

describe("what it renders", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const DESTINATION = {
    scriptUrl: "https://telemetry.balancia.app/script.js",
    websiteId: "022fe040-106c-41b1-a017-b33516835810",
    origin: "https://telemetry.balancia.app",
  };

  const configure = (): void => {
    publicPageAnalytics.mockResolvedValue(DESTINATION);
    headers.mockResolvedValue(new Headers({ "x-nonce": "abc123" }));
  };

  const render = async () =>
    (await UmamiScript()) as ReactElement<{
      nonce?: string;
      src?: string;
      dangerouslySetInnerHTML: { __html: string };
    }>;

  it("renders nothing at all while telemetry is off", async () => {
    // Which is every self-hosted install until an administrator says
    // otherwise. Nothing is fetched, so there is no third-party request to
    // block and nothing for a reader to opt out of.
    publicPageAnalytics.mockResolvedValue(null);
    headers.mockResolvedValue(new Headers());
    expect(await UmamiScript()).toBeNull();
    expect(headers).not.toHaveBeenCalled();
  });

  it("renders the bridge, and not the tracker's own tag", async () => {
    // The tracker sends everything when the hook it was told about is not
    // there. Written into the HTML beside the bridge, it would still load on
    // the day the bridge did not — so it is the bridge that loads it, and
    // nothing in the markup points at the collector.
    configure();
    const element = await render();
    expect(element.type).toBe("script");
    expect(element.props.src).toBeUndefined();
    expect(element.props.dangerouslySetInnerHTML.__html).toBe(
      pageBridge(DESTINATION),
    );
  });

  it("carries the request nonce, without which the CSP blocks it", async () => {
    // 'strict-dynamic' means host allowlists in script-src are ignored, so
    // the nonce is the only thing that authorizes the inline script — and
    // through it, the tracker it creates.
    configure();
    expect((await render()).props.nonce).toBe("abc123");
  });

  it("points at the compiled-in script and the configured website", async () => {
    configure();
    const script = (await render()).props.dangerouslySetInnerHTML.__html;
    expect(script).toContain(
      '"src":"https://telemetry.balancia.app/script.js"',
    );
    expect(script).toContain(
      '"data-website-id":"022fe040-106c-41b1-a017-b33516835810"',
    );
  });

  it("hands the script nothing about the request but its nonce", async () => {
    // The same bytes for every reader: what the bridge is told is where the
    // collector is, and nothing about who is asking.
    configure();
    expect(Object.keys((await render()).props).sort()).toEqual([
      "dangerouslySetInnerHTML",
      "nonce",
    ]);
  });
});
