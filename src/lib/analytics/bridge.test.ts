// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "@/i18n/locales";
import { PUBLIC_PAGES, publicPath } from "@/lib/public-pages";
import {
  BEFORE_SEND_HOOK,
  COUNTED_PATHS,
  COUNTED_SCREENS,
  KEPT_PARAMETERS,
  pageBridge,
} from "./bridge";

/**
 * The script that stands between a public page and the tracker.
 *
 * It is a string, shipped inline, so nothing type-checks it and nothing would
 * notice a slip in it but a dashboard filling with the wrong thing — which is
 * how the first version of this boundary failed, for two months, with every
 * test green. What is run here is that very string, in a document, against
 * the promises `docs/telemetry.md` §17 makes about it: that the collector is
 * told about the public pages and no others, that the only part of a query
 * string it ever sees is a campaign label, and that the only clicks counted
 * are on elements the source marked.
 */

interface Payload {
  url: string;
  referrer?: string;
  title?: string;
}
type Hook = (type: string, payload: Payload) => Payload | null;

const track = vi.fn();
const GROUP = "f0a42f94-7d0b-4c59-9a0e-3b1d5f1c2a77";
const EXPENSE = "9f63c1de-2b7a-4c11-8a55-0d2f6e4b7c90";

const hook = (): Hook =>
  (window as unknown as Record<string, Hook>)[BEFORE_SEND_HOOK] as Hook;

/**
 * What the collector would be sent for the page at `address`, or null when
 * it would be sent nothing.
 */
function sent(address: string, referrer?: string): Payload | null {
  window.history.replaceState({}, "", address);
  // The tracker has already dropped the query by the time the hook runs:
  // that is `data-exclude-search`, and the hook starts from what it left.
  const stripped = new URL(window.location.href);
  stripped.search = "";
  return hook()("event", {
    url: stripped.toString(),
    ...(referrer === undefined ? {} : { referrer }),
  });
}

/** The address reported for a page that is counted. */
function reported(address: string): URL {
  const payload = sent(address);
  if (!payload) throw new Error(`nothing was sent for ${address}`);
  return new URL(payload.url);
}

const DESTINATION = {
  scriptUrl: "https://telemetry.balancia.app/script.js",
  websiteId: "022fe040-106c-41b1-a017-b33516835810",
};
const BRIDGE = pageBridge(DESTINATION);

/** The tracker tags in the document. jsdom fetches none of them. */
const trackerTags = () =>
  [...document.head.querySelectorAll("script")].filter(
    (tag) => tag.getAttribute("src") === DESTINATION.scriptUrl,
  );

beforeAll(() => {
  new Function(BRIDGE)();
});

beforeEach(() => {
  track.mockClear();
  document.body.innerHTML = "";
  (window as unknown as { umami?: unknown }).umami = { track };
});

describe("how the tracker arrives", () => {
  /**
   * A tracker that finds no function under the name in `data-before-send`
   * does not stop: it sends everything. So the tag is not in the page's HTML
   * for a failed or blocked inline script to leave standing on its own. The
   * script that defines the hook is the script that writes the tag.
   */
  it("is written by the bridge, once the hook is there to be found", () => {
    const [tag, ...others] = trackerTags();
    expect(others).toEqual([]);
    expect(tag).toBeDefined();
    expect(typeof hook()).toBe("function");
    expect(tag?.getAttribute("data-before-send")).toBe(BEFORE_SEND_HOOK);
  });

  it("defines the hook before the line that writes the tag", () => {
    // Order in the source is order of execution: one script, top to bottom.
    expect(
      BRIDGE.indexOf(`window.${BEFORE_SEND_HOOK} = function`),
    ).toBeGreaterThan(-1);
    expect(
      BRIDGE.indexOf(`window.${BEFORE_SEND_HOOK} = function`),
    ).toBeLessThan(BRIDGE.indexOf("document.head.appendChild"));
  });

  it("carries the attributes that keep the query, and the signal, out of it", () => {
    const tag = trackerTags()[0];
    expect(tag?.getAttribute("data-website-id")).toBe(DESTINATION.websiteId);
    expect(tag?.getAttribute("data-exclude-search")).toBe("true");
    expect(tag?.getAttribute("data-do-not-track")).toBe("true");
    expect(tag?.getAttribute("data-performance")).toBe("true");
  });

  it("sends no identifier of its own", () => {
    // Anything Balancia knows — the user, the group, the instance — would
    // have to be put on the tag deliberately. This asserts nobody has.
    expect(trackerTags()[0]?.getAttributeNames().sort()).toEqual([
      "data-before-send",
      "data-do-not-track",
      "data-exclude-search",
      "data-performance",
      "data-website-id",
      "src",
    ]);
  });

  it("does it once, however many public layouts render the script", () => {
    // `/` and `/sign-in` each mount it. A second run would load a second
    // tracker and add a second listener, and every page and every click
    // would be counted twice.
    new Function(BRIDGE)();
    new Function(BRIDGE)();
    expect(trackerTags()).toHaveLength(1);

    document.body.innerHTML = `<a href="#" data-track="signup" data-track-at="hero">Create</a>`;
    document
      .querySelector("a")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(track).toHaveBeenCalledOnce();
  });
});

describe("which pages the collector is told about", () => {
  /**
   * The tracker is mounted on the public pages, and that was meant to be the
   * boundary. It hooks `history.pushState` when it loads, though, and signing
   * in is a navigation rather than a page load — so it went into the
   * application with every reader who signed in from a counted page, and
   * reported each screen they opened until their next reload. 96 distinct
   * addresses naming a group or an expense had reached the collector when
   * somebody read its list of pages.
   *
   * Where the tag is says nothing about a script already running. This is
   * the boundary now: every send, whatever its kind, by address.
   */
  it.each([
    "/dashboard",
    "/notifications",
    "/profile/security",
    "/settings",
    "/settings/appearance",
    `/groups/${GROUP}`,
    `/groups/${GROUP}/expenses`,
    `/groups/${GROUP}/expenses/new`,
    `/groups/${GROUP}/expenses/${EXPENSE}`,
    `/groups/${GROUP}/members/${EXPENSE}`,
    `/groups/${GROUP}/settings`,
    "/join/g/some-token",
    "/invite",
    "/offline",
  ])("sends nothing at all from %s", (address) => {
    expect(sent(address)).toBeNull();
  });

  it("sends nothing from them whatever kind of message it is", () => {
    // A page view, a click, and the timings the tracker sends on its own.
    window.history.replaceState({}, "", `/groups/${GROUP}`);
    for (const type of ["event", "performance", "identify"]) {
      expect(hook()(type, { url: window.location.href })).toBeNull();
    }
  });

  it("counts every public page, in every language", () => {
    for (const page of PUBLIC_PAGES) {
      for (const locale of LOCALES) {
        const address = publicPath(page, locale);
        expect(reported(address).pathname, address).toBe(address);
      }
    }
  });

  it.each([...COUNTED_SCREENS])(
    "counts %s, on the way to an account",
    (address) => {
      expect(reported(address).pathname).toBe(address);
    },
  );

  it("lists exact addresses, none of which could carry an identifier", () => {
    // Exact, so that no rule written for one page lets another in; and free
    // of anything shaped like a parameter, so that being on the list cannot
    // mean "and whatever follows".
    for (const address of COUNTED_PATHS) {
      expect(address).toMatch(/^\/[a-z-]*(\/[a-z-]+)*$/);
      expect(address.startsWith("/groups")).toBe(false);
      expect(address.startsWith("/join")).toBe(false);
    }
    expect(new Set(COUNTED_PATHS).size).toBe(COUNTED_PATHS.length);
  });

  it("is not opened by an address that merely begins like a counted one", () => {
    expect(sent("/sign-in/anything")).toBeNull();
    expect(sent("/register/done/anything")).toBeNull();
    expect(sent(`/fr/${GROUP}`)).toBeNull();
  });

  it("drops the fragment, so one page is one row", () => {
    // The wordmark links to `#top`, and `/#top` had become a page of its own.
    expect(reported("/#top").toString()).toBe(`${window.location.origin}/`);
  });

  it("sends nothing when it cannot tell where it is", () => {
    // Closed, not open. A hook that passed on what it could not read is the
    // hook that would have passed on the group pages.
    expect(hook()("event", { url: "http://[" })).toBeNull();
    expect(hook()("event", { url: "https://elsewhere.example/" })).toBeNull();
  });
});

describe("where the collector is told a reader came from", () => {
  it("is told the site that sent them", () => {
    expect(sent("/", "https://github.com/sebitr/balancia")?.referrer).toBe(
      "https://github.com/sebitr/balancia",
    );
  });

  it("is told the public page they came from, within the site", () => {
    expect(sent("/register", "/")?.referrer).toBe("/");
    expect(sent("/sign-in", "/fr/alternative-splitwise")?.referrer).toBe(
      "/fr/alternative-splitwise",
    );
  });

  it.each([
    ["a relative path", `/groups/${GROUP}/expenses/${EXPENSE}`],
    ["a whole address", `${window.location.origin}/groups/${GROUP}`],
    ["the dashboard", "/dashboard"],
  ])("is told nothing when that was the application (%s)", (_, referrer) => {
    // Signing out of a group lands on `/`, a counted page, with the group as
    // where the reader came from. The page view is fine; the referrer is the
    // same identifier by another door.
    const payload = sent("/", referrer);
    expect(payload?.referrer).toBe("");
    expect(JSON.stringify(payload)).not.toContain(GROUP);
  });

  it("never passes on a query from within the site", () => {
    expect(sent("/", `/sign-in?next=/groups/${GROUP}`)?.referrer).toBe(
      "/sign-in",
    );
  });
});

describe("what the collector is told about the query string", () => {
  it("is nothing, for a link that carried no label", () => {
    expect(reported("/").search).toBe("");
  });

  it("is the campaign label a link was tagged with", () => {
    const url = reported("/?utm_source=newsletter&utm_medium=email");
    expect(url.searchParams.get("utm_source")).toBe("newsletter");
    expect(url.searchParams.get("utm_medium")).toBe("email");
  });

  it("includes the label an assistant adds to the links it cites", () => {
    // The case this exists for: an answer in an app has no referrer to send,
    // and `?utm_source=chatgpt.com` is the only trace it leaves.
    const url = reported("/splitwise-alternative?utm_source=chatgpt.com");
    expect(url.pathname).toBe("/splitwise-alternative");
    expect(url.searchParams.get("utm_source")).toBe("chatgpt.com");
  });

  it("folds case, so one source is one row", () => {
    expect(
      reported("/?utm_source=ChatGPT.com").searchParams.get("utm_source"),
    ).toBe("chatgpt.com");
  });

  it("never includes the two parameters that carry a group identifier", () => {
    // `/sign-in?next=/groups/{id}` and `/register/done?group={id}` are the
    // reason the query is dropped at all.
    const signIn = reported(`/sign-in?next=/groups/${GROUP}&utm_source=mail`);
    expect([...signIn.searchParams.keys()]).toEqual(["utm_source"]);
    expect(signIn.toString()).not.toContain(GROUP);

    const done = reported(`/register/done?group=${GROUP}`);
    expect(done.search).toBe("");
  });

  it("keeps the names on its list and no others", () => {
    const everything = [...KEPT_PARAMETERS, "next", "group", "token", "email"]
      .map((name) => `${name}=label`)
      .join("&");
    expect([...reported(`/?${everything}`).searchParams.keys()].sort()).toEqual(
      [...KEPT_PARAMETERS].sort(),
    );
  });

  it("names nothing that could say who, or which group", () => {
    expect(KEPT_PARAMETERS).not.toContain("next");
    expect(KEPT_PARAMETERS).not.toContain("group");
    for (const name of KEPT_PARAMETERS) {
      expect(name).toMatch(/^(utm_[a-z]+|ref)$/);
    }
  });

  it.each([
    ["an identifier", GROUP],
    ["an identifier inside a label", "mail-f0a42f94-7d0b-4c59-9a0e"],
    ["an address", "ada%40example.com"],
    ["a path", "%2Fgroups%2Fabc"],
    ["a sentence", "dinner%20at%20chez%20marie"],
    ["something long", "a".repeat(65)],
    ["nothing", ""],
  ])("drops a value that is %s, whole", (_, value) => {
    // Whole, not cleaned up and kept: an address with the punctuation taken
    // out is still the address.
    expect(reported(`/?utm_source=${value}`).search).toBe("");
  });

  it("starts from the address without its query, whatever it was handed", () => {
    // Belt and braces for `data-exclude-search`: should the tracker ever hand
    // over a URL with its query intact, the hook drops it before adding
    // anything back.
    window.history.replaceState({}, "", "/sign-in?utm_source=mail");
    const payload = hook()("event", {
      url: `${window.location.origin}/sign-in?next=/groups/${GROUP}&utm_source=mail`,
    });
    expect(new URL(payload?.url ?? "").search).toBe("?utm_source=mail");
  });
});

describe("which clicks are counted", () => {
  const press = (selector: string) =>
    document
      .querySelector(selector)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

  it("counts an element the source marked, with what the source wrote beside it", () => {
    document.body.innerHTML = `<a href="#" data-track="signup" data-track-at="hero">Create your account</a>`;
    press("a");
    expect(track).toHaveBeenCalledExactlyOnceWith("signup", { at: "hero" });
  });

  it("counts the marked element when something inside it was pressed", () => {
    document.body.innerHTML = `<a href="#" data-track="source" data-track-at="header"><svg></svg><span>GitHub</span></a>`;
    press("span");
    expect(track).toHaveBeenCalledExactlyOnceWith("source", { at: "header" });
  });

  it("counts nothing else on the page", () => {
    document.body.innerHTML = `<a href="#">A link</a><button>A button</button><input value="typed" />`;
    press("a");
    press("button");
    press("input");
    expect(track).not.toHaveBeenCalled();
  });

  it("sends only the marked attributes, never the element's text or address", () => {
    // A fragment, so that jsdom has nowhere to navigate; what matters is that
    // the attribute is there to be read and is not.
    document.body.innerHTML = `<a href="#next=/groups/abc" title="t" data-track="sign-in" data-track-at="closing">I already have an account</a>`;
    press("a");
    expect(track.mock.calls[0]).toEqual(["sign-in", { at: "closing" }]);
  });

  it("counts a question being opened, and not the same one being closed", () => {
    document.body.innerHTML = `<details><summary data-track="faq" data-track-question="free">Is it free?</summary><p>Yes.</p></details>`;
    press("summary");
    expect(track).toHaveBeenCalledExactlyOnceWith("faq", { question: "free" });

    document.querySelector("details")?.setAttribute("open", "");
    press("summary");
    expect(track).toHaveBeenCalledOnce();
  });

  it("never stops the click it counted", () => {
    // A link must go where it goes whether or not the collector answers.
    document.body.innerHTML = `<a href="#" data-track="signup" data-track-at="hero">Create</a>`;
    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    document.querySelector("a")?.dispatchEvent(click);
    expect(click.defaultPrevented).toBe(false);
  });

  it("does nothing, quietly, where the tracker did not load", () => {
    // Blocked by an extension, or still on its way: the page works the same.
    delete (window as unknown as { umami?: unknown }).umami;
    document.body.innerHTML = `<a href="#" data-track="signup" data-track-at="hero">Create</a>`;
    expect(() => press("a")).not.toThrow();
  });
});
