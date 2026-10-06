"use client";

import { useSyncExternalStore } from "react";
import { PageHeaderClose } from "@/components/ui/page-header";
import { readOrigin, SETTINGS_FALLBACK } from "./settings-origin";

/**
 * The hub's ✕, leading back to the screen settings was opened from.
 *
 * Where that was lives in the browser (see `settings-origin.ts`), so the server
 * draws the ✕ to the dashboard and the browser corrects it as it hydrates —
 * the same bargain `AppearanceSummary` makes for the theme. Nothing changes the
 * record while the hub is on screen, so there is nothing to subscribe to.
 */
const subscribeToNothing = () => () => {};

export function SettingsClose({ label }: { label: string }) {
  const origin = useSyncExternalStore(
    subscribeToNothing,
    readOrigin,
    () => null,
  );

  return <PageHeaderClose href={origin ?? SETTINGS_FALLBACK} label={label} />;
}
