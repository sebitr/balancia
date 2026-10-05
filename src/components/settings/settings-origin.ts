/**
 * Where settings was opened from, so that closing it goes back there.
 *
 * Settings is a surface laid over the app rather than a section of it, and its
 * ✕ used to lead to the dashboard whatever had been underneath. Somebody who
 * opened it from a group to check a notification switch, and closed it again,
 * was put out of the group they had been reading.
 *
 * The same bargain as the transactions list's place (`list-place.ts`), and for
 * the same reasons. It is a fact about one visit rather than about the screen,
 * so it is not in the URL — a link to the settings hub that carried a way back
 * would be a link nobody could share, and would have to be threaded through
 * every screen of settings and back to the hub. And `sessionStorage` lasts as
 * long as the tab, which is as long as the journey: it survives a reload, and
 * the round trip to Apple when an account is linked from inside settings.
 *
 * Every way into settings from the app writes it as it is pressed — the avatar
 * in the header, and the sliders on the notifications screen — so the record is
 * always the screen the latest visit began on. Unlike the list's place it is
 * not spent once read: the hub is read again after every screen behind it, and
 * after Back, and its ✕ has to mean the same place each time.
 *
 * What is read back is never trusted as a destination. A path is followed only
 * when it is plainly one of this app's own (see `returnPath`); anything else,
 * or nothing at all — settings opened from a link in an email, in a tab of its
 * own — closes to the dashboard.
 */

const KEY = "balancia:settings-origin";

/** Where the ✕ goes when settings was not opened from a screen of the app. */
export const SETTINGS_FALLBACK = "/dashboard";

/** A placeholder origin a relative path is resolved against, never fetched. */
const HERE = "https://balancia.invalid";

/**
 * `value`, if it is a path on this site and somewhere settings can close to —
 * otherwise null.
 *
 * A way back that is followed without asking is an open redirect waiting for
 * somebody to write to it, so this is deliberately narrow: one leading slash,
 * and nothing a browser reads as the start of another host.
 *
 *  - `//host` and `/\host` are both another site to a browser, which treats a
 *    backslash in a URL as a slash.
 *  - The URL parser drops tabs and newlines before it reads anything, so
 *    `/<tab>/host` arrives as `//host`. No whitespace or control character
 *    belongs in a path the app wrote, so none is accepted at all.
 *  - `javascript:` and every other scheme fail the leading slash.
 *
 * Then, belt and braces, the path is resolved against a placeholder origin. It
 * has to still be on it, and it has to come back exactly as it went in: a path
 * the parser rewrites is one whose meaning depends on the parser, and
 * `/..//host` is rewritten to `//host`. What the app itself writes —
 * `location.pathname` and `location.search`, already in the parser's own
 * spelling — always comes back unchanged.
 *
 * And a path inside settings is not somewhere to close *to*: it would be a ✕
 * that leads back into the surface it closes.
 */
export function returnPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!value.startsWith("/") || value.startsWith("//")) return null;
  if (/[\\\s\p{Cc}]/u.test(value)) return null;

  let url: URL;
  try {
    url = new URL(value, HERE);
  } catch {
    return null;
  }
  if (url.origin !== HERE) return null;
  if (`${url.pathname}${url.search}${url.hash}` !== value) return null;
  if (url.pathname === "/settings" || url.pathname.startsWith("/settings/")) {
    return null;
  }
  return value;
}

/**
 * Remember the screen being left, on the way into settings.
 *
 * Read from `location` at the moment of the press rather than from the router:
 * a filter applied to the list, or a sheet closed through the History API, has
 * changed the address without changing the pathname, and the way back has to
 * be the address as it stands.
 */
export function rememberOrigin(): void {
  const path = returnPath(
    `${window.location.pathname}${window.location.search}`,
  );
  try {
    // A screen that cannot be gone back to still ends the last visit's claim:
    // an older origin left in place would be a ✕ to somewhere this visit
    // never started from.
    if (path === null) sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, path);
  } catch {
    // Private browsing, or a full quota. A way back that cannot be written is
    // a ✕ that leads to the dashboard, as it always used to — not a failure.
  }
}

/** Where the ✕ should lead: the screen settings was opened from, if there is one. */
export function readOrigin(): string | null {
  try {
    return returnPath(sessionStorage.getItem(KEY));
  } catch {
    return null;
  }
}
