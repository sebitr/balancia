/**
 * The directions a navigation can carry, named once so a link and the
 * stylesheet cannot drift apart. Pass one to `<Link transitionTypes>`; the
 * matching animation lives in `globals.css` and is selected by `<Screen>`.
 *
 * Which link is which is a judgement about the app's shape, not something the
 * router can work out: PUSH goes a level deeper, POP returns to where you came
 * from, and the SWITCH pair moves sideways between peers on the group's tab
 * bar.
 *
 * Everything here slides horizontally. Depth and sideways motion differ in how
 * the two screens travel, not in whether they do — see the keyframes.
 */

/** Deeper: the new screen slides in over the one you left, which recedes. */
export const PUSH: string[] = ["push"];

/** Back out: the current screen slides off, revealing the one beneath. */
export const POP: string[] = ["pop"];

/**
 * Sideways, to a tab further along the bar: both screens travel together to
 * the left, like a filmstrip advancing. Neither covers the other, because
 * neither is on top of the other.
 */
export const SWITCH_FORWARD: string[] = ["switch-forward"];

/** Sideways, to a tab further back: the same filmstrip, wound the other way. */
export const SWITCH_BACK: string[] = ["switch-back"];

/**
 * Paths that can be a layer over a screen rather than a screen of their own,
 * each capturing the part of itself that says where it may be opened from.
 *
 * Only the add-entry drawer, which is intercepted into the group's `@entry`
 * slot: the URL becomes `/groups/<id>/expenses/new`, but `children` goes on
 * rendering whatever was underneath, which is the whole point of intercepting
 * it. `(.)` only intercepts from the same segment level, so the drawer is a
 * layer when it was opened from inside `/groups/<id>` and a screen in its own
 * right when it was reached from anywhere else — a link on the dashboard, or a
 * cold load of the URL.
 */
const OVERLAYS = [/^(\/groups\/[^/]+)\/expenses\/new$/];

/** Whether `path` is `root` itself or something inside it. */
function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

/**
 * Which screen a path is showing, given the last screen it was reached from.
 *
 * `<Screen>` is keyed on this rather than on the pathname, because opening a
 * drawer is not a navigation between screens. Keyed on the raw pathname, the
 * screen behind the drawer exited and re-entered on the way in and back out
 * again on the way out — it ran an animation under a sheet that was rising
 * over it, and remounted, so it came back scrolled to the top.
 *
 * `from` is what makes this the screen you were actually on. Deriving the
 * screen from the overlay's own URL instead put the drawer over `/groups/<id>`
 * wherever it was opened, so the overview held still and every other screen in
 * the group — the transactions list above all — went on sliding, now to a path
 * it had never been on.
 */
export function screenPath(pathname: string, from: string | null): string {
  for (const overlay of OVERLAYS) {
    const opensFrom = overlay.exec(pathname)?.[1];
    if (opensFrom === undefined) continue;
    return from !== null && isUnder(from, opensFrom) ? from : pathname;
  }
  return pathname;
}
