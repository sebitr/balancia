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
 * How — if at all — this browser can put Balancia on the home screen.
 *
 *  - `unavailable` — already installed, or a browser with neither a native
 *    prompt nor a documented manual route. Offer nothing rather than send the
 *    user hunting through menus.
 *  - `prompt` — Chromium handed us an install event we can fire on demand.
 *  - `ios-share` — iOS/iPadOS Safari has no install API; the share sheet is
 *    the only route, so the best we can do is say where it is.
 *  - `ios-browser` — Chrome, Edge or Firefox on iOS. They are all WebKit and
 *    none of them can install a real PWA, so the honest answer is "open this
 *    in Safari" rather than instructions that will not work.
 */
export type InstallMethod =
  "unavailable" | "prompt" | "ios-share" | "ios-browser";

export interface InstallState {
  readonly method: InstallMethod;
  /** There is *some* route to installation worth offering. */
  readonly canInstall: boolean;
  /** Running in a standalone window right now. */
  readonly isInstalled: boolean;
  readonly isIos: boolean;
  readonly isAndroid: boolean;
  /** Chromium has handed over an event we can fire without any instructions. */
  readonly isInstallPromptAvailable: boolean;
  /** The proactive suggestion has been waved away; the menu action stays. */
  readonly suggestionDismissed: boolean;
  /** The platform instructions panel is open. */
  readonly instructionsOpen: boolean;
}

/** Remembers a dismissal so the suggestion does not nag on every visit. */
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
function detectInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari predates display-mode and sets this instead.
    (window.navigator as Navigator & { standalone?: boolean }).standalone ===
      true
  );
}

function detectIos(): boolean {
  const ua = window.navigator.userAgent;
  // iPadOS 13+ reports a desktop Safari user agent; the touch points are what
  // give it away.
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    (/macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

/**
 * Chrome, Edge, Firefox or Opera on iOS.
 *
 * Apple requires every iOS browser to use WebKit, and only Safari may add a
 * real web app to the home screen — the others either offer nothing or create
 * a plain bookmark. Their vendor prefixes in the user agent are the only way
 * to tell, and they are stable precisely because Apple mandates the engine.
 */
function detectIosNonSafari(): boolean {
  return /crios|edgios|fxios|opios/i.test(window.navigator.userAgent);
}

function detectAndroid(): boolean {
  return /android/i.test(window.navigator.userAgent);
}

/**
 * Installability is browser state, not React state: the event can arrive
 * before anything mounts, and it arrives exactly once. So it lives in a module
 * store that components read through `useSyncExternalStore`, which also gives
 * us a server snapshot for free and keeps hydration honest.
 *
 * The instructions panel lives here too. There is only ever one of it, and it
 * is opened from places that cannot share React state — a dropdown item that
 * unmounts the moment the menu closes, and a banner elsewhere in the tree.
 */
const listeners = new Set<() => void>();

let deferred: BeforeInstallPromptEvent | null = null;
/** What the platform alone allows, before any Chromium event is considered. */
let platformMethod: InstallMethod = "unavailable";
let installed = false;
let ios = false;
let android = false;
let dismissed = false;
let instructionsOpen = false;
let initialized = false;

/**
 * Nothing on offer — what the server renders.
 *
 * The server cannot know the platform, so it renders no install affordance at
 * all and the client fills one in after hydration. Going from nothing to
 * something never flickers; the reverse would.
 */
const SERVER_SNAPSHOT: InstallState = {
  method: "unavailable",
  canInstall: false,
  isInstalled: false,
  isIos: false,
  isAndroid: false,
  isInstallPromptAvailable: false,
  suggestionDismissed: true,
  instructionsOpen: false,
};

let snapshot: InstallState = SERVER_SNAPSHOT;

function computeSnapshot(): InstallState {
  // A live Chromium event beats the platform guess; being installed beats
  // everything, since there is nothing left to offer.
  let method: InstallMethod = "unavailable";
  if (!installed) {
    method = deferred !== null ? "prompt" : platformMethod;
  }
  return {
    method,
    canInstall: method !== "unavailable",
    isInstalled: installed,
    isIos: ios,
    isAndroid: android,
    isInstallPromptAvailable: !installed && deferred !== null,
    suggestionDismissed: dismissed,
    instructionsOpen,
  };
}

/** `useSyncExternalStore` requires a stable reference between changes. */
function publish(): void {
  const next = computeSnapshot();
  const unchanged = (Object.keys(next) as (keyof InstallState)[]).every(
    (key) => next[key] === snapshot[key],
  );
  if (unchanged) {
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
  installed = detectInstalled();
  dismissed = readDismissed();
  ios = detectIos();
  android = detectAndroid();
  // Everything else — desktop Safari, Firefox, Android browsers without the
  // event — stays `unavailable` unless Chromium says otherwise, because there
  // is no instruction we could give that would reliably work.
  platformMethod = ios
    ? detectIosNonSafari()
      ? "ios-browser"
      : "ios-share"
    : "unavailable";
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
  platformMethod = "unavailable";
  installed = false;
  ios = false;
  android = false;
  dismissed = false;
  instructionsOpen = false;
  initialized = false;
  snapshot = SERVER_SNAPSHOT;
  if (typeof window !== "undefined") {
    window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  }
}

export interface PwaInstall extends InstallState {
  /**
   * Does whatever this platform allows: fires Chromium's native prompt, or
   * opens the instructions panel where that is the only route. Resolves once
   * the user has answered, so callers can await the outcome.
   */
  install: () => Promise<void>;
  /** Silences the proactive suggestion for good. */
  dismissSuggestion: () => void;
  closeInstructions: () => void;
}

/** Drives every "install Balancia" affordance in the app. */
export function usePwaInstall(): PwaInstall {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const dismissSuggestion = useCallback(() => {
    dismissed = true;
    writeDismissed();
    publish();
  }, []);

  const closeInstructions = useCallback(() => {
    instructionsOpen = false;
    publish();
  }, []);

  const install = useCallback(async () => {
    const event = deferred;
    if (!event) {
      // No native prompt: either the platform needs talking through, or there
      // is nothing to do at all.
      if (platformMethod !== "unavailable" && !installed) {
        instructionsOpen = true;
        publish();
      }
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

  return { ...state, install, dismissSuggestion, closeInstructions };
}
