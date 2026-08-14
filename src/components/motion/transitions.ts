/**
 * The three directions a navigation can carry, named once so a link and the
 * stylesheet cannot drift apart. Pass one to `<Link transitionTypes>`; the
 * matching animation lives in `globals.css` and is selected by `<Screen>`.
 *
 * Which link is which is a judgement about the app's shape, not something the
 * router can work out: PUSH goes a level deeper, POP returns to where you came
 * from, SWITCH moves sideways between peers on the group's tab bar.
 */

/** Deeper: the new screen slides in over the one you left. */
export const PUSH: string[] = ["push"];

/** Back out: the current screen slides off, revealing the one beneath. */
export const POP: string[] = ["pop"];

/** Sideways, between peers — a crossfade, because nowhere new was entered. */
export const SWITCH: string[] = ["switch"];
