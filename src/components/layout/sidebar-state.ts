/**
 * Whether the desktop sidebar is folded down to its icons, kept per device.
 *
 * A cookie rather than local storage, so the server draws the sidebar at the
 * width it will stay at: read from storage after hydration, a collapsed
 * sidebar would paint at 240px and snap to 64px a frame later, dragging the
 * screen beside it along. Not a secret, so the browser writes it itself — the
 * toggle is a control that flicks back, and a round trip to the server for it
 * would only make the press feel slower.
 *
 * The expanded sidebar is the absence of a choice, so it clears the cookie
 * rather than recording one.
 */
export const SIDEBAR_COOKIE_NAME = "balancia_sidebar";

export const SIDEBAR_COLLAPSED = "collapsed";

/** A year, like every other display preference this app keeps per device. */
export const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Anything but the one value is the default — the cookie is not HttpOnly. */
export function isSidebarCollapsed(value: string | undefined): boolean {
  return value === SIDEBAR_COLLAPSED;
}
