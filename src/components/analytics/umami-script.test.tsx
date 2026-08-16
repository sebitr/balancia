import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
 * The privacy claim here is not a property of Umami's configuration — it is a
 * property of *which pages the script is on*. Balancia's URLs name groups and
 * expenses (`/groups/f0a42f94-…/expenses/9f63…`), a page view carries the
 * URL, and no tracker setting makes that safe to hand to a third party. So
 * the script goes on the pages that have no identifier and no session behind
 * them, and the first test below is the one that keeps it there.
 */

const PUBLIC_SURFACE = [
  // The landing page: signed-out only, since a session redirects to
  // /dashboard before this renders.
  path.join("src", "app", "page.tsx"),
  // /sign-in, /register, /register/done.
  path.join("src", "app", "(auth)", "layout.tsx"),
];

/** Every file under src/ that imports the component, repository-relative. */
function importers(): string[] {
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
        const source = readFileSync(full, "utf8");
        if (
          /from ["']@\/components\/analytics\/umami-script["']/.test(source)
        ) {
          found.push(path.relative(process.cwd(), full));
        }
      }
    }
  };
  walk(path.join(process.cwd(), "src"));
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
      importers(),
      "the tracker must not reach a page whose URL names a group or an " +
        "expense; see the comment in src/lib/analytics/umami.ts",
    ).toEqual([...PUBLIC_SURFACE].sort());
  });

  it("is not in the root layout, which wraps the whole application", () => {
    const root = readFileSync(
      path.join(process.cwd(), "src", "app", "layout.tsx"),
      "utf8",
    );
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
    const landing = readFileSync(
      path.join(process.cwd(), "src", "app", "page.tsx"),
      "utf8",
    );
    if (!/no\s+analytics/i.test(landing)) return;
    expect(
      landing,
      "src/app/page.tsx claims there are no analytics; it must call " +
        "publicPageAnalytics() so the claim is only made when it is true",
    ).toMatch(/publicPageAnalytics\(\)/);
  });
});

describe("the tag it renders", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  const configure = (): void => {
    publicPageAnalytics.mockResolvedValue({
      scriptUrl: "https://telemetry.balancia.app/script.js",
      websiteId: "022fe040-106c-41b1-a017-b33516835810",
      origin: "https://telemetry.balancia.app",
    });
    headers.mockResolvedValue(new Headers({ "x-nonce": "abc123" }));
  };

  it("renders nothing at all while telemetry is off", async () => {
    // Which is every self-hosted install until an administrator says
    // otherwise. Nothing is fetched, so there is no third-party request to
    // block and nothing for a reader to opt out of.
    publicPageAnalytics.mockResolvedValue(null);
    headers.mockResolvedValue(new Headers());
    expect(await UmamiScript()).toBeNull();
    expect(headers).not.toHaveBeenCalled();
  });

  it("excludes the query string, which is where the group identifiers are", async () => {
    // `/sign-in?next=/groups/{id}` comes from groups/[groupId]/layout.tsx and
    // `/register/done?group={id}` from registration. Both are public pages
    // with an identifier in the query, and this attribute is what stops it.
    configure();
    const element = await UmamiScript();
    expect(element?.props["data-exclude-search"]).toBe("true");
  });

  it("honours Do Not Track", async () => {
    configure();
    const element = await UmamiScript();
    expect(element?.props["data-do-not-track"]).toBe("true");
  });

  it("carries the request nonce, without which the CSP blocks it", async () => {
    // 'strict-dynamic' means host allowlists in script-src are ignored, so
    // the nonce is the only thing that authorizes this tag.
    configure();
    const element = await UmamiScript();
    expect(element?.props.nonce).toBe("abc123");
  });

  it("points at the compiled-in script and the configured website", async () => {
    configure();
    const element = await UmamiScript();
    expect(element?.props.src).toBe("https://telemetry.balancia.app/script.js");
    expect(element?.props["data-website-id"]).toBe(
      "022fe040-106c-41b1-a017-b33516835810",
    );
    expect(element?.props.defer).toBe(true);
  });

  it("sends no identifier of its own", async () => {
    // Anything Balancia knows — the user, the group, the instance — would
    // have to be put here deliberately. This asserts nobody has.
    configure();
    const element = await UmamiScript();
    expect(Object.keys(element?.props ?? {}).sort()).toEqual([
      "data-do-not-track",
      "data-exclude-search",
      "data-website-id",
      "defer",
      "nonce",
      "src",
    ]);
  });
});
