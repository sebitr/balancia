/**
 * The kinds of navigation the app can make, named once so a link and the
 * stylesheet cannot drift apart. Pass one to `<Link transitionTypes>`; the
 * matching animation lives in `globals.css` and is selected by `<Screen>`.
 *
 * Which one a link is cannot be worked out by the router: it is a judgement
 * about what the destination *is* to the reader, and the same URL can be two
 * different things depending on where it was tapped from. Three kinds, and
 * they deliberately do not look alike:
 *
 *   depth   — PUSH and POP, a page stacked on the one before it. It travels.
 *   section — the SWITCH pair, a peer on the group's tab bar or another
 *             group in the switcher. It fades through, going nowhere.
 *   layer   — MODAL, something that opens over what you were looking at and
 *             brings its own motion. The screen underneath does not move.
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
 * Over the top: a drawer or a sheet, which carries its own animation.
 *
 * The screen behind stays exactly where it was, because it is still the thing
 * you are looking at — that is what makes the layer read as a layer. Sliding
 * it sideways as well put two motions on screen at once, each claiming a
 * different thing had happened.
 *
 * `<Screen>` maps this onto React's `"none"`, which opts the screen out of the
 * transition altogether rather than animating it to a standstill.
 */
export const MODAL: string[] = ["modal"];
