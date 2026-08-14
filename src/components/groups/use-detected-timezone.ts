"use client";

import { useSyncExternalStore } from "react";
import { detectTimezone } from "@/lib/timezones";

/**
 * The device's own timezone, or null until there is a device to ask.
 *
 * A server render cannot know it, and the app's Content-Security-Policy rules
 * out the usual fix of correcting the DOM from an inline script before
 * hydration. So this reports null on the server and the detected zone from
 * hydration onwards: React is told about the two snapshots rather than
 * discovering a mismatch, and nothing has to be written from an effect.
 */

/** The zone cannot change under a running tab, so there is nothing to watch. */
const subscribe = () => () => {};

let detected: string | null | undefined;

function getSnapshot(): string | null {
  // Cached because `getSnapshot` has to answer the same thing every time.
  if (detected === undefined) detected = detectTimezone();
  return detected;
}

function getServerSnapshot(): string | null {
  return null;
}

export function useDetectedTimezone(): string | null {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
