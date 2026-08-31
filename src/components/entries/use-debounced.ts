"use client";

import { useEffect, useState } from "react";

/**
 * A value that lags behind, so nothing reacts mid-keystroke.
 *
 * The duplicate note needs this more than most: it appears and disappears as
 * an amount is typed, and a line that flashes while somebody is on the third
 * digit of a number is noise about a figure they have not finished writing.
 * Waiting for the value to settle is what makes it read as an observation
 * rather than a twitch.
 *
 * Deliberately not the debounce inside `useCategorySuggestion`: that one is
 * tied to a classification and its own two-pass refinement, and pulling this
 * out of it would leave that hook explaining a generality it does not have.
 */
export function useDebounced<T>(value: T, delayMs: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return settled;
}
