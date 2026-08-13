"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * `beforeinstallprompt` is Chromium-only and absent from TypeScript's DOM lib,
 * so the shape the spec describes is declared here.
 */
interface BeforeInstallPromptEvent extends Event {
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  prompt(): Promise<void>;
}

/**
 * What, if anything, we can offer the visitor.
 *
 *  - `unavailable` — already installed, unsupported browser, or Chromium has
 *    not judged the app installable (yet). Offer nothing.
 *  - `prompt` — Chromium handed us an install event we can fire on demand.
 *  - `manual` — iOS has no install API at all; the only route is the share
 *    sheet, so all we can do is tell the user where it is.
 */
export type InstallAvailability = "unavailable" | "prompt" | "manual";

export interface InstallState {
  readonly availability: InstallAvailability;
  readonly dismissed: boolean;
}

/** Remembers a dismissal so the banner does not nag on every page. */
const DISMISSED_KEY = "balancia:install-dismissed";

/** localStorage throws rather than no-ops in some privacy modes. */
function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === "1";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, "1");
  } catch {
    // A dismissal we cannot persist still holds for this page view.
  }
}

/** True when the page is already running as an installed app. */
function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari predates display-mode and sets this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function isIos(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports a desktop Safari user agent; the touch points are what
  // give it away.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

/**
 * Installability is browser state, not React state: the event can arrive
 * before anything mounts, and it arrives exactly once. So it lives in a module
 * store that components read through `useSyncExternalStore`, which also gives
 * us a server snapshot for free and keeps hydration honest.
 */
const listeners = new Set<() => void>();

let deferred: BeforeInstallPromptEvent | null = null;
let platform: InstallAvailability = "unavailable";
let installed = false;
let dismissed = false;
let initialized = false;

/** Nothing on offer — what the server renders, and the shape of "no". */
const SERVER_SNAPSHOT: InstallState = {
  availability: "unavailable",
  dismissed: true,
};

let snapshot: InstallState = SERVER_SNAPSHOT;

function computeSnapshot(): InstallState {
  // A live Chromium event beats the platform guess; being installed beats
  // everything, since there is nothing left to offer.
  let availability: InstallAvailability = platform;
  if (installed) {
    availability = "unavailable";
  } else if (deferred !== null) {
    availability = "prompt";
  }
  return { availability, dismissed };
}

/** `useSyncExternalStore` requires a stable reference between changes. */
function publish(): void {
  const next = computeSnapshot();
  if (
    next.availability === snapshot.availability &&
    next.dismissed === snapshot.dismissed
  ) {
    return;
  }
  snapshot = next;
  for (const listener of listeners) {
    listener();
  }
}

function onBeforeInstallPrompt(event: Event): void {
  // Without this Chromium shows its own mini-infobar and withholds the event;
  // we want the invitation to appear on our terms.
  event.preventDefault();
  deferred = event as BeforeInstallPromptEvent;
  publish();
}

function onInstalled(): void {
  installed = true;
  deferred = null;
  publish();
}

/**
 * Reads the platform once and starts listening.
 *
 * The window listeners are never removed: `beforeinstallprompt` fires a single
 * time, and dropping the listener when the last component unmounts would mean
 * missing it on a route that remounts the shell.
 */
function initialize(): void {
  if (initialized || typeof window === "undefined") {
    return;
  }
  initialized = true;
  installed = isInstalled();
  dismissed = readDismissed();
  platform = isIos() ? "manual" : "unavailable";
  snapshot = computeSnapshot();

  window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
  window.addEventListener("appinstalled", onInstalled);
}

function subscribe(listener: () => void): () => void {
  initialize();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): InstallState {
  initialize();
  return snapshot;
}

function getServerSnapshot(): InstallState {
  return SERVER_SNAPSHOT;
}

/** Test seam: drops the captured state so each case starts clean. */
export function resetInstallPromptForTests(): void {
  listeners.clear();
  deferred = null;
  platform = "unavailable";
  installed = false;
  dismissed = false;
  initialized = false;
  snapshot = SERVER_SNAPSHOT;
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  }
}

/** Drives the "add to home screen" affordance. */
export function useInstallPrompt(): InstallState & {
  install: () => Promise<void>;
  dismiss: () => void;
} {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dismiss = useCallback(() => {
    dismissed = true;
    writeDismissed();
    publish();
  }, []);

  const install = useCallback(async () => {
    const event = deferred;
    if (!event) {
      return;
    }
    await event.prompt();
    const { outcome } = await event.userChoice;
    // The event is single-use either way. Chromium fires a fresh one on a
    // later visit if the user declines and stays eligible.
    deferred = null;
    if (outcome === "dismissed") {
      // Declining the OS sheet is a clearer "no" than ignoring a banner.
      dismissed = true;
      writeDismissed();
    }
    publish();
  }, []);

  return { ...state, install, dismiss };
}
