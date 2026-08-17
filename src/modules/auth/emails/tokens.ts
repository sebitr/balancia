/**
 * The palette the HTML emails are built from.
 *
 * Literal hex, because email clients support neither `oklch()` nor custom
 * properties — so these cannot read `src/app/globals.css` the way the rest of
 * the interface does. Every value is nonetheless *derived* from it rather than
 * chosen here, and `tokens.test.ts` re-derives all of them from that file on
 * every run: move a token and the test names the value that no longer follows.
 *
 * Most are a straight conversion of the light theme's token. Three are
 * computed, because the role has no token of its own and picking a colour by
 * eye is how a palette stops being the theme's:
 *
 *  - `link` is `--primary` taken down in lightness until 14px text on the
 *    cream panel reaches WCAG AA. Coral as a fill is a button; the same coral
 *    as body copy is 2.8:1, so it is never used for text.
 *  - `destructiveTint` is `--destructive` at 8% over `--card`.
 *  - `destructiveInk` is `--destructive` taken down until it reaches AAA on
 *    that tint — far enough below the title to keep the panel's hierarchy,
 *    still recognisably the same red.
 *
 * Hue and chroma are never touched, only lightness, so what comes out is the
 * token and not a second colour that happens to pass.
 */
export const palette = {
  /** `--border`. Page ground, hairlines, the card's own border. */
  ground: "#E2DDD5",
  /** `--background`. Card wrapper, the link-fallback panel, the wordmark. */
  wrapper: "#FAF7F2",
  /** `--card`. The body cells. */
  surface: "#FFFFFF",
  /** `--foreground`. Headings, body copy, the header bar. */
  ink: "#2A0E31",
  /** `--muted-foreground`. Secondary copy and labels. */
  mutedInk: "#6B5E6E",
  /** `--primary`. Button fill and the dot in the mark. */
  primary: "#F97360",
  /** `--primary-foreground`. The button's label — plum on coral, not white. */
  primaryInk: "#2A0E31",
  /** `--primary`, darkened for AA. See above. */
  link: "#C64435",
  /** `--destructive`. The warning panel's title and link. */
  destructive: "#C51B32",
  /** `--destructive` at 8% over `--card`. */
  destructiveTint: "#FAEDEF",
  /** `--destructive`, darkened for AAA on that tint. */
  destructiveInk: "#A50017",
} as const;

/**
 * No web fonts: an email client will not load one, and a missing font is a
 * worse outcome than a safe one. Arial stands in for Instrument Sans, Georgia
 * for Instrument Serif; the tight letter-spacing on large text is what carries
 * the brand's typography across the substitution.
 */
export const fonts = {
  sans: "Arial,Helvetica,sans-serif",
  serif: "Georgia,'Times New Roman',serif",
  mono: "'Courier New',Courier,monospace",
} as const;

/**
 * The Balancia mark, served from the instance's own origin.
 *
 * An image rather than the inline SVG the interface uses, because Gmail and
 * Outlook drop inline SVG entirely. It is decorative — the wordmark beside it
 * is live text — so it carries an empty `alt` and an image-blocking client
 * loses nothing but the glyph.
 *
 * Written by `pnpm icons`, drawn at 2× for a 24px slot.
 */
export const MARK = {
  path: "/email/mark.png",
  width: 24,
  height: 24,
} as const;
