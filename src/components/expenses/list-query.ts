/**
 * The filters the transactions list keeps in its URL, and how to carry them.
 *
 * Four places have to agree on these three names: the island that writes them,
 * the rows that link out of it, and the two detail screens that link back. So
 * they live here rather than in the island, which is a `"use client"` module —
 * a Server Component that only wanted three strings would otherwise pull a
 * whole component's imports in behind them.
 *
 * Carrying the filters through the detail screen is what makes leaving a row
 * and coming back to it the same journey in both directions. Before this, the
 * back button on a transaction pushed the bare list URL, and a reader who had
 * narrowed to Lodging and searched for a hotel arrived at everything the group
 * had ever recorded, at the top.
 */

/** A chosen category. Repeats: several bands can be on at once. */
export const FILTER_PARAM = "cat";

/** A chosen kind — expense, revenue, settlement. Repeats, for the same reason. */
export const KIND_PARAM = "kind";

/** What was typed in the search field. */
export const QUERY_PARAM = "q";

/**
 * The order they are written in, which is also the order `listQuery` prints.
 *
 * Fixed rather than taken from whatever the URL happened to hold, so the same
 * filters always produce the same string — see `ListPlace`, which compares two
 * of them to decide whether a remembered position is a position in *this* list.
 */
const LIST_PARAMS = [FILTER_PARAM, KIND_PARAM, QUERY_PARAM] as const;

/**
 * Either shape the filters arrive in: `useSearchParams` in the island, and the
 * plain record a Server Component is handed.
 */
export type ParamSource =
  URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

/**
 * Just the list's own filters, canonically ordered, as a query string.
 *
 * Only these three: anything else on the URL belongs to whoever put it there,
 * and forwarding it into a detail screen and back out again would make this
 * function a general-purpose query launderer rather than a statement about
 * what the list is showing.
 */
export function listQuery(source: ParamSource): string {
  const query = new URLSearchParams();
  for (const name of LIST_PARAMS) {
    for (const value of valuesOf(source, name)) {
      // An empty value is a filter that is not on. It would round-trip as
      // `q=`, which is a different string from no `q` at all — enough to make
      // a remembered position look like it belongs to another list.
      if (value !== "") query.append(name, value);
    }
  }
  return query.toString();
}

/** `path`, with a query behind it when there is one to carry. */
export function withQuery(path: string, query: string): string {
  return query === "" ? path : `${path}?${query}`;
}

/**
 * Every value under one name.
 *
 * Duck-typed rather than `instanceof URLSearchParams`: `ReadonlyURLSearchParams`
 * is Next's own subclass, and a subclass identity is not something to bet a
 * silently-empty filter on.
 */
function valuesOf(source: ParamSource, name: string): readonly string[] {
  if (typeof (source as URLSearchParams).getAll === "function") {
    return (source as URLSearchParams).getAll(name);
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}
