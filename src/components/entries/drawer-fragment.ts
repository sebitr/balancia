/**
 * What the entry drawer is told on the way in — which debt to open on, that a
 * draft should be put back, which sheet to raise, which list the reader came
 * from — travels in the URL fragment, the part after `#`. Never in the query
 * string.
 *
 * It was the query string, and the drawer wedged. The drawer is an intercepted
 * route: a `<Link>` to `/groups/<id>/expenses/new` opens it over the group, and
 * Next prefetches such a link up to the loading boundary in `@entry/loading.tsx`
 * so the sheet can rise on the tap. The prefetch of an intercepted route came
 * back recording no search params at all — Next 16.3's router notes, in its own
 * source, that the header it reads this from "is sometimes wrong for
 * interception routes" — so the route the client stored said the page had no
 * query, while the page the server then rendered was keyed by it. Faced with
 * the disagreement the router abandoned the page it had started, retried the
 * whole navigation from the root (two full-tree requests, one for the drawer's
 * URL and one for the screen beneath it, plus a re-prefetch of every tab), and
 * left the abandoned page in its back/forward cache for `staleTimes.dynamic`.
 * The retry is why the first open cost a round trip more than it should. The
 * cache entry is why a second open inside thirty seconds showed the skeleton
 * and nothing else: the router had a page for that URL, and the page was
 * empty. Reopening the same button did it; so did reopening a different one.
 *
 * A fragment never reaches the server, so there is nothing to mis-record. Every
 * debt, draft and sheet opens the one route, the prefetch and the render agree,
 * and a drawer reopened inside the window comes straight from the cache. The
 * cost is that the server can no longer read the intent, so the drawer reads it
 * on the client — which is where the form is built anyway, and where the
 * balances it prices a debt from already are.
 *
 * Ordinary screens keep their queries. The transactions list's filters, and the
 * detail screens that carry them, reopen correctly; the fault was specific to
 * the intercepted routes.
 */

/**
 * Set to `1` to put the group's half-written entry back into the form.
 *
 * A parameter rather than a route: it is the same drawer either way, and a
 * second route would be a second place for the form to be constructed.
 */
export const RESUME_PARAM = "draft";

/**
 * A sheet to open with the drawer. `split` is the only value anything writes:
 * the saved-entry toast's "Paid by" and "Split between" both link to the split
 * sheet of the entry they describe.
 */
export const SHEET_PARAM = "sheet";

/** Anything `URLSearchParams` can be built from: a query string, another set, or a plain record. */
export type FragmentParams =
  string | URLSearchParams | Readonly<Record<string, string>>;

/**
 * `path#a=b`, or `path` alone when there is nothing to say.
 *
 * Merges with a fragment the path already carries, name by name: a parameter
 * named again replaces every value it had, one it does not name is kept. That
 * is what lets a link add its sheet to an edit URL that arrived carrying the
 * list's filters.
 */
export function withFragment(path: string, params: FragmentParams): string {
  const at = path.indexOf("#");
  const base = at === -1 ? path : path.slice(0, at);
  const merged = new URLSearchParams(at === -1 ? "" : path.slice(at + 1));
  const incoming = new URLSearchParams(params);
  for (const name of new Set(incoming.keys())) merged.delete(name);
  for (const [name, value] of incoming) merged.append(name, value);
  const fragment = merged.toString();
  return fragment === "" ? base : `${base}#${fragment}`;
}

/** The parameters in a fragment, with or without its leading `#`. */
export function fragmentParams(hash: string): URLSearchParams {
  return new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
}

/** The sheet a fragment asks for. Anything but a name the form knows is no sheet. */
export function sheetOf(params: URLSearchParams): "split" | undefined {
  return params.get(SHEET_PARAM) === "split" ? "split" : undefined;
}
