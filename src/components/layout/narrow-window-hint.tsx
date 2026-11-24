"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useDeskWidth } from "@/components/ui/use-desk-width";
import {
  isNarrowWindow,
  NARROW_COOKIE_MAX_AGE,
  NARROW_COOKIE_NAME,
  NARROW_WINDOW,
} from "./narrow-window";

/** The hint as the browser holds it now. */
function readNarrow(): boolean {
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${NARROW_COOKIE_NAME}=`));
  return isNarrowWindow(entry?.slice(NARROW_COOKIE_NAME.length + 1));
}

/** Written only when it changes, so a resize does not write on every frame. */
function rememberNarrow(narrow: boolean) {
  if (readNarrow() === narrow) return;
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = narrow
    ? `${NARROW_COOKIE_NAME}=${NARROW_WINDOW}; path=/; max-age=${NARROW_COOKIE_MAX_AGE}; samesite=lax${secure}`
    : `${NARROW_COOKIE_NAME}=; path=/; max-age=0; samesite=lax${secure}`;
}

/**
 * Tells the server how wide this window is, for the next screen it draws —
 * and asks for this one again if it was drawn for a phone and the window is
 * now a desk's. See `narrow-window.ts`.
 *
 * Draws nothing. The width is only known after hydration, so the hint always
 * describes the render after this one: a phone's first visit is drawn whole,
 * as before, and every one after it without the sidebar's list and the group
 * header's counts. A window that crosses `lg` the other way — a desk window
 * dragged narrow, a tablet turned — is only recorded: what it was sent is
 * hidden at its new width, and costs nothing more to keep.
 *
 * Asked again once per drawing at most, and only when the cookie really did
 * clear, so a browser that refuses to write it is not refreshed in a loop.
 */
export function NarrowWindowHint({
  leftOut,
}: {
  /** Whether the server left the desk-only reads out of this render. */
  leftOut: boolean;
}) {
  const desk = useDeskWidth();
  const router = useRouter();
  const asked = useRef(false);

  useEffect(() => {
    if (!leftOut) asked.current = false;
    if (desk === null) return;
    rememberNarrow(!desk);
    if (desk && leftOut && !asked.current && !readNarrow()) {
      asked.current = true;
      router.refresh();
    }
  }, [desk, leftOut, router]);

  return null;
}
