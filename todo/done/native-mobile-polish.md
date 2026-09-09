# Make the installed app behave like one on a phone: the position kept under the header once you scroll past it, the unread count on the home-screen icon, a screen that re-reads itself when you come back to it, swipe a transaction away to delete it, and icons on the manifest's shortcuts

Merged: 2026-09-08 in #324

Five things a phone does that this did not, from a sweep of the shipped
screens at 375×812 against what 2026 actually shipped in browsers. They are
one topic — an installed PWA that behaves like an app rather than a page — and
they share `--app-header-h`, which the strip needs and the header now states.

The position strip is the interesting one. It is entirely CSS: `scroll(root
block)` as an animation timeline, no listener and no measuring. Two traps are
written up beside it in `globals.css` and both are silent. `scroll()` without
`root` resolves to the _nearest_ scroll container, and a `fixed` element
descends from none, so the timeline never advances and the strip simply never
appears. And an `animation-timeline` a browser does not understand falls back
to the document timeline, playing the animation through once on load — so the
whole block sits inside `@supports`, with `display: none` outside it.

Swipe-to-delete deliberately does not confirm where `DeleteEntryButton` does.
The reasoning is at the top of `swipe-to-delete.tsx`: a 104px drag names its
own target and cannot be done by accident, and the Undo toast protects the
change of mind better than a dialog that precedes it. Deletion is soft either
way.

Balance rows were considered for the swipe and left alone. `BalanceList` is a
server component whose rows are `grid-cols-subgrid` onto the list's own tracks;
wrapping each in a client swipe container breaks the subgrid that keeps the
bars in line, and swiping to _navigate_ is not an idiom the hand knows.

Haptics are Android-only — `navigator.vibrate`, which Safari does not
implement at all. Nothing depends on the buzz; it is laid over confirmations
that are already on the screen.
