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
 * Paths that are a layer over the screen rather than a screen of their own.
 *
 * Only the add-entry drawer, which is intercepted into the group's `@entry`
 * slot: the URL becomes `/groups/<id>/expenses/new`, but `children` goes on
 * rendering the group underneath, which is the whole point of intercepting it.
 */
const OVERLAYS = [/^(\/groups\/[^/]+)\/expenses\/new$/];

/**
 * Which screen a path is showing, ignoring anything opened over it.
 *
 * `<Screen>` is keyed on this rather than on the pathname, because opening a
 * drawer is not a navigation between screens. Keyed on the raw pathname, the
 * group behind the drawer exited and re-entered on the way in and back out
 * again on the way out — it ran the push animation under a sheet that was
 * sliding up over it, and remounted, so it came back scrolled to the top.
 */
export function screenPath(pathname: string): string {
  for (const overlay of OVERLAYS) {
    const beneath = pathname.replace(overlay, "$1");
    if (beneath !== pathname) return beneath;
  }
  return pathname;
}
