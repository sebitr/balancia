/**
 * A repayment the screen that opened the drawer already knows the shape of.
 *
 * The settle-up screen and the overview's settlement list both state a debt
 * before anybody taps anything — "Seb pays Amélie, EUR 148.60" — so the form
 * that opens next should not ask those questions again. It travels on the URL
 * rather than in a store, because the drawer is a route: it has to survive a
 * refresh, a shared link and a cold load, all of which a store does not.
 *
 * Three names live here rather than at either end, so the screen that writes
 * them and the route that reads them cannot drift apart. The amount is
 * deliberately *not* one of them — see `settleIntentOf`.
 */

/** Who hands the money over. */
export const SETTLE_FROM_PARAM = "settleFrom";

/** Who receives it. */
export const SETTLE_TO_PARAM = "settleTo";

/**
 * What the debt is denominated in.
 *
 * Carried because a group in `separate` mode balances several currencies at
 * once and the same two people can owe each other in two of them; without it
 * the drawer would have to guess which debt was tapped.
 */
export const SETTLE_CURRENCY_PARAM = "settleIn";

export interface SettleIntent {
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly currency: string;
}

/**
 * Either shape the query arrives in: `useSearchParams` in a client island, and
 * the plain record a Server Component is handed. Mirrors `list-query`, which
 * reads the same two shapes for the same reason.
 */
export type ParamSource =
  URLSearchParams | Readonly<Record<string, string | string[] | undefined>>;

/** The path that opens the add-entry drawer on this debt. */
export function settleIntentPath(
  groupId: string,
  intent: SettleIntent,
): string {
  const query = new URLSearchParams({
    [SETTLE_FROM_PARAM]: intent.fromParticipantId,
    [SETTLE_TO_PARAM]: intent.toParticipantId,
    [SETTLE_CURRENCY_PARAM]: intent.currency,
  });
  return `/groups/${groupId}/expenses/new?${query.toString()}`;
}

/**
 * The intent on a query, or null when the drawer was opened plain.
 *
 * All three or nothing: two thirds of a debt is not a debt, and prefilling one
 * name and leaving the other blank would be a worse start than an empty form.
 *
 * There is no amount here on purpose. The screen that linked here rendered its
 * figure at *its* request, and by the time this route runs somebody else may
 * have recorded a payment against the same debt. Naming the two people and
 * letting the drawer read what is outstanding *now* means the amount on the
 * form is the amount that is actually owed, rather than a number copied out of
 * a stale screen.
 */
export function settleIntentOf(source: ParamSource): SettleIntent | null {
  const from = valueOf(source, SETTLE_FROM_PARAM);
  const to = valueOf(source, SETTLE_TO_PARAM);
  const currency = valueOf(source, SETTLE_CURRENCY_PARAM);

  if (!from || !to || !currency) return null;
  // Nobody repays themselves; the form refuses it too, and a query that says
  // so is a link somebody edited rather than one this app wrote.
  if (from === to) return null;

  return {
    fromParticipantId: from,
    toParticipantId: to,
    currency,
  };
}

/**
 * One value under a name, or "" when it is absent or repeated.
 *
 * Duck-typed rather than `instanceof URLSearchParams`, as in `list-query`:
 * `ReadonlyURLSearchParams` is Next's own subclass, and a subclass identity is
 * not something to bet a silently-empty prefill on.
 */
function valueOf(source: ParamSource, name: string): string {
  if (typeof (source as URLSearchParams).get === "function") {
    return (source as URLSearchParams).get(name) ?? "";
  }
  const value = (source as Record<string, string | string[] | undefined>)[name];
  // A repeated parameter names two debts, which is one more than the form can
  // open on. Answering "none" sends the reader to a blank settle tab instead
  // of to whichever of the two happened to be written first.
  return typeof value === "string" ? value : "";
}
