import { LOCALES } from "@/i18n/locales";
import { PUBLIC_PAGES, publicPath } from "@/lib/public-pages";

/**
 * What stands between a public page and the tracker: the last word on what
 * the collector is told, about which pages, and nothing else.
 *
 * It does three things, and the first is the one that matters most.
 *
 *  1. **It refuses every address that is not on `COUNTED_PATHS`.** Mounting
 *     the tracker only on public pages was meant to be the whole boundary,
 *     and it was not one. The tracker hooks `history.pushState` when it
 *     loads and counts every navigation after that — and signing in is a
 *     navigation, not a page load. So a reader who opened `/sign-in` took
 *     the tracker into the application with them, and every screen they
 *     opened until their next full reload was reported by path: 96 distinct
 *     addresses with a group or an expense identifier in them had reached
 *     the collector when somebody finally read its page list. The tag being
 *     absent from a page says nothing about a script that is already
 *     running. What is sent is decided here instead, at the moment of
 *     sending, by the address itself — and a referrer is held to the same
 *     list, because `/` reached by signing out of a group names that group
 *     as where the reader came from.
 *
 *  2. **It lets a campaign label through, when the link that brought the
 *     reader carried one.** The tracker is mounted with
 *     `data-exclude-search`, which drops the whole query string, and has to
 *     be: `/sign-in?next=/groups/{id}` is a public page with a group
 *     identifier in its query. But the query is also where `utm_source`
 *     lives, and an assistant that cites Balancia adds exactly that to the
 *     link it shows — it is often the only trace an answer leaves, an app
 *     having no referrer to send. So the query stays dropped, and the hook
 *     puts back the parameters on `KEPT_PARAMETERS` and no others, and only
 *     when the value is shaped like a label.
 *
 *  3. **It counts which of the page's own buttons was pressed.** An element
 *     marked `data-track="…"` is counted when clicked. The name and anything
 *     beside it are literals in the source — a button's place on the page, a
 *     question's key — never something the reader typed or the database
 *     holds.
 *
 * And it is what loads the tracker. The tag is not in the page's HTML: this
 * script writes it, as its last act, after the hook exists. A tracker that
 * finds no hook under the name it was given does not stop — it sends
 * everything — so the one arrangement in which this file's failure cannot
 * become the leak above is the one where the tracker only ever arrives by
 * way of it.
 *
 * It is a string rather than a module because it has to run before React
 * does: the tracker counts the page view as soon as the document has loaded,
 * and the hook must already be there. `bridge.test.ts` runs this very string.
 */

/** The global the tracker's `data-before-send` attribute names. */
export const BEFORE_SEND_HOOK = "balanciaBeforeSend";

/**
 * The screens outside the page table that a stranger passes through on the
 * way to an account. None has an identifier in its path; two have one in
 * their query, which is never sent.
 */
export const COUNTED_SCREENS = [
  "/sign-in",
  "/register",
  "/register/password",
  "/register/done",
  "/forgot-password",
  "/reset-password",
] as const;

/**
 * Every address the collector may be told about, exactly. Not a pattern: a
 * pattern is how `/groups/…` gets let in by a rule written for something
 * else.
 */
export const COUNTED_PATHS: readonly string[] = [
  ...PUBLIC_PAGES.flatMap((page) =>
    LOCALES.map((locale) => publicPath(page, locale)),
  ),
  ...COUNTED_SCREENS,
];

/**
 * The query parameters the tracker may be told about. A list of names that
 * mean "which link was this", and nothing that could mean "who is this" or
 * "which group": `next` and `group`, the two that carry an identifier on the
 * public pages, are not here and no pattern could let them in.
 */
export const KEPT_PARAMETERS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "ref",
] as const;

/**
 * A label: `newsletter`, `chatgpt.com`, `awesome-selfhosted`. Lower-cased
 * first, so one source is one row rather than three.
 *
 * Anything else is dropped whole rather than cleaned up and kept — the reason
 * `telemetry/crash.ts` gives for the same choice: an address with its
 * punctuation removed is still the address.
 */
const LABEL = "^[a-z0-9][a-z0-9._-]{0,63}$";

/**
 * The opening of a UUID, which is what every Balancia identifier is. A value
 * that passes `LABEL` and contains this is refused: a label has no reason to
 * look like one, and somebody's group link pasted into the wrong parameter
 * would.
 */
const IDENTIFIER = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}";

/**
 * The script itself, for one destination.
 *
 * The four attributes it gives the tracker are the ones `umami-script.tsx`
 * explains. They are set here rather than there because this is where the
 * tag is made.
 */
export function pageBridge(destination: {
  scriptUrl: string;
  websiteId: string;
}): string {
  return `(function () {
  // Once per document. A second copy would count every click twice and load
  // a second tracker to count every page twice.
  if (window.${BEFORE_SEND_HOOK}) return;

  var TRACKER = ${JSON.stringify({
    src: destination.scriptUrl,
    "data-website-id": destination.websiteId,
    "data-before-send": BEFORE_SEND_HOOK,
    "data-exclude-search": "true",
    "data-do-not-track": "true",
    "data-performance": "true",
  })};
  var COUNTED = ${JSON.stringify(COUNTED_PATHS)};
  var KEPT = ${JSON.stringify(KEPT_PARAMETERS)};
  var LABEL = /${LABEL}/;
  var IDENTIFIER = /${IDENTIFIER}/;

  function counted(pathname) {
    return COUNTED.indexOf(pathname.replace(/\\/+$/, "") || "/") !== -1;
  }

  window.${BEFORE_SEND_HOOK} = function (type, payload) {
    try {
      var here = window.location.origin;
      var url = new URL(payload.url, here);
      if (url.origin !== here || !counted(url.pathname)) return null;

      var asked = new URLSearchParams(window.location.search);
      url.search = "";
      url.hash = "";
      KEPT.forEach(function (name) {
        var value = (asked.get(name) || "").toLowerCase();
        if (LABEL.test(value) && !IDENTIFIER.test(value)) {
          url.searchParams.set(name, value);
        }
      });
      payload.url = url.toString();

      if (payload.referrer) {
        var from = new URL(payload.referrer, here);
        if (from.origin === here) {
          payload.referrer = counted(from.pathname) ? from.pathname : "";
        }
      }
      return payload;
    } catch (error) {
      return null;
    }
  };

  document.addEventListener(
    "click",
    function (event) {
      var from = event.target;
      var marked = from && from.closest ? from.closest("[data-track]") : null;
      if (!marked || !window.umami) return;
      // A question that is open is being closed, which is not interest in it.
      if (marked.tagName === "SUMMARY" && marked.parentNode.open) return;
      var data = {};
      var names = marked.getAttributeNames();
      for (var index = 0; index < names.length; index += 1) {
        var name = names[index];
        if (name.indexOf("data-track-") === 0) {
          data[name.slice(11)] = marked.getAttribute(name);
        }
      }
      window.umami.track(marked.getAttribute("data-track"), data);
    },
    true
  );

  // Last, and only now that the hook is there for it to find.
  var tag = document.createElement("script");
  for (var attribute in TRACKER) tag.setAttribute(attribute, TRACKER[attribute]);
  // 'strict-dynamic' lets a script this one creates run without a nonce of
  // its own. A browser that does not know the keyword falls back to the
  // nonce, so it is handed on.
  if (document.currentScript && document.currentScript.nonce) {
    tag.nonce = document.currentScript.nonce;
  }
  document.head.appendChild(tag);
})();`;
}
