import "server-only";
import { getCurrentUser } from "@/lib/security/actor";
import {
  getUserFavoriteCurrencies,
  getUserPreferredCurrency,
} from "@/modules/auth/service";
import { seedFavoriteCurrencies } from "./favorites";

/**
 * What the root layout hands the currency picker.
 *
 * Resolved once per request, next to the language and the date notation, and
 * for the same reason: it is one value per reader that half a dozen screens
 * would otherwise each have to fetch for themselves.
 *
 * Signed out, or signed in as a guest, there is nothing to read and nothing to
 * write — the picker keeps whatever gets starred for the length of the visit
 * and the provider is told not to try to persist it.
 */

export interface CurrencyFavorites {
  readonly favorites: readonly string[];
  readonly persist: boolean;
}

export async function resolveCurrencyFavorites(): Promise<CurrencyFavorites> {
  const user = await getCurrentUser();
  if (!user) return { favorites: [], persist: false };

  const stored = await getUserFavoriteCurrencies(user.userId);
  if (stored.length > 0) return { favorites: stored, persist: true };

  // Never starred anything: the currency their home screen totals in is the
  // one fact we have about where they spend, so it starts the list. An account
  // that has not chosen that either gets no favourites section at all, which
  // is the design's own answer to an empty list.
  const preferred = await getUserPreferredCurrency(user.userId);
  return { favorites: seedFavoriteCurrencies(preferred), persist: true };
}
