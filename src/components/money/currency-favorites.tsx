"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { setFavoriteCurrenciesAction } from "@/modules/profile/actions";
import { toggleFavoriteCurrency } from "@/modules/currencies/favorites";

/**
 * Starred currencies, carried to every picker in the app.
 *
 * One provider at the root rather than a prop threaded through seven forms —
 * the same shape as `FormatPreferencesProvider`, and for the same reason: the
 * value is one per reader, not one per screen, and a currency starred in the
 * expense form is starred in the group form a second later.
 *
 * The star writes through to the account in the background. It does not wait,
 * and it does not report failure: the list is a convenience, the tap has
 * already landed on screen, and the worst case is a favourite that does not
 * follow the reader to their next device. A guest — who has no account to
 * store it on — keeps their favourites for the length of the visit, which is
 * as long as anything else about a guest lasts.
 */

interface FavoritesValue {
  readonly favorites: readonly string[];
  readonly toggle: (code: string) => void;
}

const FavoritesContext = createContext<FavoritesValue | null>(null);

export function CurrencyFavoritesProvider({
  initial,
  /** False for a guest or a signed-out reader: keep it, do not try to store it. */
  persist = true,
  children,
}: {
  initial: readonly string[];
  persist?: boolean;
  children: ReactNode;
}) {
  const [favorites, setFavorites] = useState<readonly string[]>(initial);

  /**
   * The next list is computed before the state is set, not inside the updater.
   *
   * React is free to run an updater while rendering, and a Server Action
   * started from in there updates the router mid-render — which React reports
   * as updating one component while rendering another. Toggling only ever
   * happens from a tap, so the current list is already the fresh one here.
   */
  const toggle = useCallback(
    (code: string) => {
      const next = toggleFavoriteCurrency(favorites, code);
      setFavorites(next);
      if (persist) void setFavoriteCurrenciesAction(next);
    },
    [favorites, persist],
  );

  const value = useMemo(() => ({ favorites, toggle }), [favorites, toggle]);

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

/**
 * Falls back to an empty list rather than throwing when there is no provider,
 * so a component test that renders one form in isolation gets a working picker
 * with no favourites section — which is exactly what a new account sees.
 */
export function useCurrencyFavorites(): FavoritesValue {
  const context = useContext(FavoritesContext);
  const fallback = useFallbackFavorites();
  return context ?? fallback;
}

/**
 * The no-provider case still has to be stateful: a star that does not move
 * when pressed reads as broken, whether or not anything is listening.
 */
function useFallbackFavorites(): FavoritesValue {
  const [favorites, setFavorites] = useState<readonly string[]>([]);
  const toggle = useCallback(
    (code: string) => setFavorites(toggleFavoriteCurrency(favorites, code)),
    [favorites],
  );
  return useMemo(() => ({ favorites, toggle }), [favorites, toggle]);
}
