/**
 * Whether this device's window was last seen below `lg`, kept per device so
 * the server can leave out what only a desk draws.
 *
 * The sidebar's list of groups is every group's balances — Home's whole
 * overview — and a group's header counts its people and entries in four more
 * reads. Both are `display: none` below `lg`, and both used to be read on
 * every group screen at every width, so a phone paid for a column and a
 * header it never shows.
 *
 * The server cannot know the width, so the browser tells it, after the fact:
 * `NarrowWindowHint` writes this cookie whenever the window is below `lg` and
 * clears it from `lg` up, and the next render on this device leaves the two
 * reads out. The desk is the absence of a hint, so a device the server has
 * never heard from — a first visit, a browser that keeps no cookies — is
 * drawn as it always was, and only a window that has been narrow is ever
 * drawn without them. A window that widens past `lg` while drawn without them
 * asks for the screen again; see `narrow-window-hint.tsx`.
 *
 * Not a secret and not about anybody, so the browser writes it itself, like
 * the sidebar's fold (`sidebar-state.ts`).
 */
export const NARROW_COOKIE_NAME = "balancia_narrow";

export const NARROW_WINDOW = "1";

/** A year, like every other display preference this app keeps per device. */
export const NARROW_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything but the one value is a desk — the cookie is not HttpOnly. */
export function isNarrowWindow(value: string | undefined): boolean {
  return value === NARROW_WINDOW;
}
