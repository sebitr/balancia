/**
 * The palette the HTML emails are built from.
 *
 * Literal hex, because email clients support neither `oklch()` nor custom
 * properties — so these cannot read `src/app/globals.css` the way the rest of
 * the interface does, and are the one place in the codebase where a colour is
 * written twice. If a token in globals.css moves, the matching value here has
 * to be moved with it by hand.
 *
 * Most of these are the sRGB conversion of their token. Three are not, and the
 * difference is deliberate rather than drift:
 *
 *  - `mutedInk` is far more saturated than `--muted-foreground` converts to
 *    (chroma 0.107 against 0.03). A near-grey reads as washed-out at 12–15px on
 *    a white card in an email client that has applied its own contrast.
 *  - `destructive` is darker and more orange than `--destructive` converts to,
 *    which is what carries it over the tinted panel it sits on.
 *  - `link` is `--primary` darkened until body-size text on the light fills
 *    meets WCAG AA. Raw coral does not, so it is never used for text.
 *
 * Values and rationale come from the design handoff; see docs/emails.md.
 */
export const palette = {
  /** `--border`. Page ground, hairlines, the card's own border. */
  ground: "#EDE3D6",
  /** `--background`. Card wrapper and the link-fallback panel. */
  wrapper: "#FBF7F1",
  /** `--card`. The body cells. */
  surface: "#FFFFFF",
  /** `--foreground`. Headings, body copy, the button label, the header bar. */
  ink: "#2A0E31",
  /** Secondary copy and labels. See the note above. */
  mutedInk: "#7A4A85",
  /** `--primary`. Button fill and the brand dot. */
  primary: "#F97361",
  /** `--primary`, darkened for AA on the light fills. */
  link: "#B04A32",
  /** Warning title and link. See the note above. */
  destructive: "#A32B14",
  /** `--destructive` at roughly 8%. The warning panel's fill. */
  destructiveTint: "#FAEDEA",
  /** Warning body copy, dark enough to read on the tint. */
  destructiveInk: "#5C2A2A",
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
