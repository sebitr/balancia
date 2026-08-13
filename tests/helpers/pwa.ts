import { act } from "@testing-library/react";
import { vi } from "vitest";

/**
 * Browser stubs for the install flow.
 *
 * None of the installation APIs exist in jsdom: `beforeinstallprompt` is a
 * Chromium event, standalone mode is a display mode no headless DOM enters,
 * and the platform is only ever knowable from the user agent. So each is
 * stood up here rather than depended on for real, and the tests assert on what
 * the store makes of them.
 */

/** Real strings, because the detection reads vendor prefixes out of them. */
export const USER_AGENTS = {
  iosSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  iosChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1",
  iosEdge:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 EdgiOS/126.0.2592.87 Mobile/15E148 Safari/604.1",
  /** iPadOS 13+ claims to be a Mac; only the touch points give it away. */
  ipadSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36",
  /** Gecko on Android: never fires `beforeinstallprompt`. */
  androidFirefox:
    "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0",
  desktopChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  desktopFirefox:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0",
} as const;

/**
 * Presents the browser as a given platform.
 *
 * `maxTouchPoints` matters on its own: it is the only thing separating an iPad
 * from the desktop Mac whose user agent it borrows.
 */
export function setUserAgent(value: string, maxTouchPoints = 0): void {
  Object.defineProperty(window.navigator, "userAgent", {
    value,
    configurable: true,
  });
  Object.defineProperty(window.navigator, "maxTouchPoints", {
    value: maxTouchPoints,
    configurable: true,
  });
}

const realMatchMedia = window.matchMedia;

/** Reports the app as already running in a standalone window. */
export function stubStandalone(): void {
  window.matchMedia = ((query: string) => ({
    matches: query.includes("standalone"),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** iOS Safari predates `display-mode` and reports standalone on `navigator`. */
export function stubIosStandalone(): void {
  Object.defineProperty(window.navigator, "standalone", {
    value: true,
    configurable: true,
  });
}

export function restoreDisplayMode(): void {
  window.matchMedia = realMatchMedia;
  Object.defineProperty(window.navigator, "standalone", {
    value: undefined,
    configurable: true,
  });
}

export interface FakeInstallPromptEvent extends Event {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** Stands in for the Chromium event, which jsdom has no notion of. */
export function fireBeforeInstallPrompt(
  outcome: "accepted" | "dismissed" = "accepted",
): FakeInstallPromptEvent {
  const event = new Event("beforeinstallprompt") as FakeInstallPromptEvent;
  event.prompt = vi.fn().mockResolvedValue(undefined);
  event.userChoice = Promise.resolve({ outcome });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

/** The event Chromium fires once the app lands on the home screen. */
export function fireAppInstalled(): void {
  act(() => {
    window.dispatchEvent(new Event("appinstalled"));
  });
}
