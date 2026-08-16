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
