"use client";

import { useEffect } from "react";
import type { ContrastChoice } from "@/modules/profile/surface";

/**
 * Keeps "Auto" contrast following the system after the first paint.
 *
 * The pre-paint script in the root layout reads the system's preference
 * once, before anything is drawn. This is the other half: while the reader
 * has not chosen, a change to that preference — the switch in the system
 * settings — moves the attribute the moment it happens, the way the theme
 * provider follows `prefers-color-scheme`. A reader who chose "Standard" or
 * "Increased" is left alone; the attribute is theirs.
 */
export function ContrastFollower({ choice }: { choice: ContrastChoice }) {
  useEffect(() => {
    if (choice !== "auto") return;
    const query = window.matchMedia("(prefers-contrast: more)");
    const follow = () => {
      const root = document.documentElement;
      if (query.matches) root.setAttribute("data-contrast", "more");
      else root.removeAttribute("data-contrast");
    };
    follow();
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  return null;
}
