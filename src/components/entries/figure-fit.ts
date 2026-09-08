"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * The amount, at whatever size still shows all of it.
 *
 * The figure is a display numeral drawn at 44px, and at that size about seven
 * characters fit in the room a phone leaves between the card's edge and the
 * currency chip. A settlement that clears a five-figure debt is eight —
 * `12801.75` — so the last digits ran off the end of the field. A number half
 * shown is worse than a smaller number shown whole: nothing on the screen says
 * it is cut, so the figure simply reads as the wrong amount.
 *
 * So the size is measured rather than designed. A copy of the text is laid out
 * at full size where nothing can see it, and the figure is scaled by whatever
 * ratio brings that width inside the field's own. Measuring is what makes it
 * right at every width without a table of guesses: the room depends on the
 * viewport, on the sign in front of the figure and on the chip beside it, and
 * the width of the text depends on the font's digits — tabular here, which is
 * not the width the same string has anywhere else.
 */

/** The size the figure is drawn at whenever it has the room. */
export const FIGURE_MAX_PX = 44;

/**
 * The smallest the figure will be drawn.
 *
 * Not a matter of taste: it is the app's own floor, the 16px at or above which
 * Safari on iOS leaves the page alone when a field takes focus — a point under
 * it and the reader is zoomed in for good, once per tap, which is a worse
 * trade than a small figure. `text-entry-size.test.ts` has the long form; the
 * inline size set here outranks the `max(1rem, 1em)` the same rule puts under
 * every control below `md`, so that base rule cannot be what catches this one.
 *
 * The field cannot hold an amount that needs less. `sanitiseAmount` caps the
 * whole part at eight digits and the fraction at the currency's own exponent —
 * three at most, in dinars — so twelve characters is the longest anybody can
 * type. On a 320px phone, the narrowest the app draws for, that worst case
 * comes out at 22px with every character of it on screen — and it is the only
 * thing in the app that comes anywhere near the floor. `12801.75`, the
 * settlement that started this, is drawn at 42px on a 375px phone.
 */
export const FIGURE_MIN_PX = 16;

/** The currency chip's type when the figure beside it is at full size. */
export const CHIP_MAX_PX = 24;

/**
 * The smallest the chip's type will be drawn.
 *
 * Everything in the chip is set in `em`, so this size takes the pill, its
 * padding, the flag and the chevron down with it — a 34px pill rather than a
 * 48px one. That is under the 44px a finger is owed, which is why the chip
 * carries `tap-target`: the target stays 44px whatever the pill is drawn at,
 * the same trade the header's icons make.
 */
export const CHIP_MIN_PX = 17;

/**
 * The chip's type for a figure drawn at `figure` px.
 *
 * The chip is a caption to the figure and reads at the same distance, so it
 * keeps its proportion to it rather than standing at full height beside a
 * shrunken amount — which is what it did, and what left `12801.75` looking
 * like the smaller half of its own card.
 *
 * The figure this is asked about is the one the room would allow if the chip
 * had never given way — not the one finally drawn. The two would otherwise
 * chase each other: a narrower chip leaves more room, more room draws a larger
 * figure, a larger figure draws the chip back out. Measured through the DOM
 * that ran until the browser stopped delivering resize notifications, and left
 * the figure a size too large and cut off — the very bug this file is for.
 * Asking the question once, of a figure that cannot answer back, ends it.
 */
export function chipPxFor(figure: number): number {
  const scaled = Math.round((figure * CHIP_MAX_PX) / FIGURE_MAX_PX);
  return Math.min(CHIP_MAX_PX, Math.max(CHIP_MIN_PX, scaled));
}

/**
 * The width a chip drawn at `px` gives back, from a chip `full` px wide.
 *
 * Every length in the pill is set in `em` bar the one pixel of border down
 * each side, so its width follows its type once those two are taken out and
 * put back. Rounded down, so the figure is never handed a pixel that is not
 * there.
 */
export function chipFreedPx(px: number, full: number): number {
  if (full <= 0) return 0;
  return Math.max(0, Math.floor(full - (2 + ((full - 2) * px) / CHIP_MAX_PX)));
}

/**
 * The two pixels kept back from the field's width.
 *
 * A figure measured to the last pixel of its field leaves the caret with
 * nowhere to stand after the last digit, and the browser scrolls the field to
 * make room for it — which takes a sliver off the first digit instead. They
 * also cover the rounding in `chipFreedPx`.
 */
const CARET_PX = 2;

/**
 * The size at which text `wanted` px wide fits a field `room` px wide.
 *
 * Rounded down, which leaves the field a few pixels of slack at any real
 * length: a point of size is worth about half a point per character, so
 * flooring an eight-character figure gives back four or five pixels.
 */
export function fittedFigurePx(room: number, wanted: number): number {
  // Nothing to measure against — server-rendered, display:none, or a test's
  // jsdom, where every box is zero — and the designed size is the answer.
  if (room <= 0 || wanted <= 0) return FIGURE_MAX_PX;
  const usable = room - CARET_PX;
  if (wanted <= usable) return FIGURE_MAX_PX;
  const scaled = Math.floor((FIGURE_MAX_PX * usable) / wanted);
  return Math.min(FIGURE_MAX_PX, Math.max(FIGURE_MIN_PX, scaled));
}

/**
 * The sizes to draw the figure and its chip at, and the three elements they
 * are measured from.
 *
 * `field` is the input the text has to fit inside; `mirror` is the invisible
 * copy of that text at `FIGURE_MAX_PX`, which is what makes this one
 * measurement rather than a search — the ratio of the two widths is the ratio
 * of the sizes. `chip` is the currency chip, measured only so that its own
 * shrinking can be taken back out of the field's width.
 *
 * Both sizes come out of the one pass, in this order: the room as it would be
 * beside a full-size chip decides what the chip is drawn at, and the figure
 * then takes that room plus everything the smaller chip freed. Neither can
 * move the other afterwards, which is what keeps this to a single answer per
 * keystroke — the card must therefore draw the chip at the size returned here
 * rather than deriving one of its own.
 *
 * The observer watches all three. The field's width changes without the text
 * changing — a rotation, a desk window dragged narrower, the sign appearing in
 * front of an income — and the mirror's changes when the web font finishes
 * loading and the fallback's digits give way to the real ones, which for
 * tabular figures is not a small difference.
 */
export function useFittedFigure(text: string): {
  size: number;
  chipSize: number;
  fieldRef: React.RefObject<HTMLInputElement | null>;
  mirrorRef: React.RefObject<HTMLSpanElement | null>;
  chipRef: React.RefObject<HTMLButtonElement | null>;
} {
  const fieldRef = useRef<HTMLInputElement | null>(null);
  const mirrorRef = useRef<HTMLSpanElement | null>(null);
  const chipRef = useRef<HTMLButtonElement | null>(null);
  // The widest the chip has been seen, which is the width it has at full
  // size: it is drawn at full size before anything is typed, and it is only
  // ever asked to be smaller. Kept across texts, because the chip is at
  // whatever size the last amount left it when the next one is measured.
  const chipFullRef = useRef(0);
  const [fitted, setFitted] = useState({
    size: FIGURE_MAX_PX,
    chipSize: CHIP_MAX_PX,
  });

  // Layout, not effect: the size is settled before the frame is painted, so
  // nobody sees the figure at 44px on its way to 30.
  useLayoutEffect(() => {
    const field = fieldRef.current;
    const mirror = mirrorRef.current;
    const chip = chipRef.current;
    if (!field || !mirror || !chip) return;

    // Both widths are laid-out ones, not painted ones: a sheet caught
    // mid-animation is a scaled box on the screen and its own size in the
    // layout, and a ratio taken across the two would settle on the wrong size
    // and stay there, because the layout never changed to say otherwise.
    //
    // Two widths in and one size out, so the same pair of widths is the same
    // answer: measuring again changes nothing and the observer stops there.
    // Without that, every size the hook sets would come straight back as a
    // resize — the field is as tall as its type — and the fit would run twice
    // for every keystroke to reach the number it already had.
    let last = "";
    const fit = () => {
      chipFullRef.current = Math.max(chipFullRef.current, chip.offsetWidth);
      // The room the field would have if the chip beside it had never shrunk:
      // the same number before and after the chip follows the figure down,
      // which is what keeps the two from driving each other. Taking the widest
      // the chip has been also errs the safe way if it is ever wrong — a room
      // read too small draws a figure that fits with something to spare.
      const room = field.clientWidth + chip.offsetWidth - chipFullRef.current;
      const wanted = mirror.offsetWidth;
      if (`${room}:${wanted}` === last) return;
      last = `${room}:${wanted}`;

      const chipSize = chipPxFor(fittedFigurePx(room, wanted));
      const freed = chipFreedPx(chipSize, chipFullRef.current);
      setFitted({ size: fittedFigurePx(room + freed, wanted), chipSize });
    };

    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(field);
    observer.observe(mirror);
    observer.observe(chip);
    return () => observer.disconnect();
  }, [text]);

  return { ...fitted, fieldRef, mirrorRef, chipRef };
}
