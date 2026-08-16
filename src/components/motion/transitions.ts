/**
 * The kinds of navigation the app can make, named once so a link and the
 * stylesheet cannot drift apart. Pass one to `<Link transitionTypes>`; the
 * matching animation lives in `globals.css` and is selected by `<Screen>`.
 *
 * Which one a link is cannot be worked out by the router: it is a judgement
 * about what the destination *is* to the reader. Two kinds, and they
 * deliberately do not look alike:
 *
 *   depth   — PUSH and POP, a page stacked on the one before it. It travels.
 *   section — the SWITCH pair, a peer on the group's tab bar or another
 *             group in the switcher. It fades through, going nowhere.
 *
 * There is deliberately no third kind for a drawer. Something that opens
 * *over* the screen has not navigated between screens at all, so it carries no
 * direction and `screenPath` below keeps it on the same key — see `<Screen>`.
 */

/** Deeper: a page on top of the one you left, which recedes behind it. */
export const PUSH: string[] = ["push"];

/** Back out: the page you are leaving goes, uncovering the one beneath. */
export const POP: string[] = ["pop"];

/**
 * Sideways, to a section further along the bar: the current view fades out and
 * the next fades in with a nudge from the right. Neither covers the other,
 * because neither is on top of the other — a tab bar is not a stack.
 */
export const SWITCH_FORWARD: string[] = ["switch-forward"];

/** Sideways, to a section nearer the start: the same fade, nudged the other way. */
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
