/**
 * The currencies a reader has starred.
 *
 * Per account, not per group: someone who lives in Switzerland and holidays in
 * Thailand wants CHF and THB near the top of every picker they open, in the
 * group for the flat share as much as in the one for the trip.
 *
 * Order is the reader's own — a newly starred currency goes to the end — so
 * the list stays where they left it rather than resorting itself under their
 * hand. The picker re-reads it when it opens, never while it is open.
 */

import { isSupportedCurrency } from "./iso-4217";

/**
 * Past a dozen, "favourites" is just the list again with extra steps. The cap
 * is also what stops a hostile client from writing an unbounded array into the
 * account row.
 */
export const MAX_FAVORITE_CURRENCIES = 12;

/**
 * What is safe to store: known codes, uppercased, no duplicates, capped.
 *
 * Applied on the way in from the client and on the way out of the database
 * alike — a currency can be withdrawn from `iso-4217` after someone starred
 * it, and a row that is no longer valid should quietly stop being shown rather
 * than break the picker.
 */
export function sanitiseFavoriteCurrencies(
  codes: readonly unknown[],
): string[] {
  const seen = new Set<string>();
  for (const code of codes) {
    if (typeof code !== "string") continue;
    const value = code.trim().toUpperCase();
    if (!isSupportedCurrency(value)) continue;
    seen.add(value);
    if (seen.size >= MAX_FAVORITE_CURRENCIES) break;
  }
  return [...seen];
}

/**
 * What to star for someone who has never starred anything.
 *
 * Deliberately not a hard-coded CHF/EUR/USD: those are three guesses about
 * where the reader lives. The currencies they already have are a fact — the
 * one their home screen totals in, and the one the field they just opened is
 * set to — and between them they cover the first run of nearly every account,
 * because the group form seeds its currency from the account's preference in
 * the first place.
 *
 * When there is neither, the picker shows no favourites section at all rather
 * than an invented one. The star is on every row; the list builds itself.
 */
export function seedFavoriteCurrencies(
  ...codes: readonly (string | null | undefined)[]
): string[] {
  return sanitiseFavoriteCurrencies(codes.filter((code) => code != null));
}

/**
 * Starred becomes unstarred; unstarred goes to the end.
 *
 * At the cap the oldest favourite makes room rather than the new one being
 * refused: a star that visibly does nothing is a bug to whoever pressed it,
 * and twelve is far enough down the list that losing the first is unlikely to
 * be noticed — or minded.
 */
export function toggleFavoriteCurrency(
  favorites: readonly string[],
  code: string,
): string[] {
  if (favorites.includes(code)) {
    return favorites.filter((favorite) => favorite !== code);
  }
  return sanitiseFavoriteCurrencies(
    [...favorites, code].slice(-MAX_FAVORITE_CURRENCIES),
  );
}
