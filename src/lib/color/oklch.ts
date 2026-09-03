/**
 * OKLCH to sRGB, and the contrast maths that goes with it.
 *
 * The interface is authored in OKLCH — `src/app/globals.css` defines every
 * token that way, and browsers evaluate it directly. Two places cannot:
 * email clients, which support neither `oklch()` nor custom properties, and
 * the icon rasteriser, which writes PNGs. Both need a literal hex, and this is
 * how one is derived rather than eyeballed.
 *
 * The conversion is Björn Ottosson's, unchanged: OKLCH → OKLab → LMS → linear
 * sRGB → gamma-encoded sRGB. Out-of-gamut values are clipped per channel,
 * which is the same thing a browser does for a colour it cannot show.
 */

export interface Oklch {
  /** Perceptual lightness, 0–1. */
  readonly l: number;
  /** Chroma. 0 is grey; the sRGB gamut runs out somewhere below 0.4. */
  readonly c: number;
  /** Hue angle in degrees. */
  readonly h: number;
}

/** Matches `oklch(0.712 0.168 30)`, with or without the function wrapper. */
const OKLCH_PATTERN =
  /^\s*(?:oklch\(\s*)?(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s*\)?\s*$/;

export function parseOklch(value: string): Oklch | null {
  const match = OKLCH_PATTERN.exec(value);
  if (!match) return null;
  const [l, c, h] = match.slice(1, 4).map(Number);
  return Number.isFinite(l) && Number.isFinite(c) && Number.isFinite(h)
    ? { l, c, h }
    : null;
}

/** Linear-light sRGB, each channel clipped into gamut. */
function toLinearRgb({ l, c, h }: Oklch): [number, number, number] {
  const radians = (h * Math.PI) / 180;
  const a = c * Math.cos(radians);
  const b = c * Math.sin(radians);

  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].map((channel) => Math.min(1, Math.max(0, channel))) as [
    number,
    number,
    number,
  ];
}

function encodeGamma(channel: number): number {
  return channel > 0.0031308
    ? 1.055 * channel ** (1 / 2.4) - 0.055
    : 12.92 * channel;
}

function decodeGamma(channel: number): number {
  return channel > 0.04045
    ? ((channel + 0.055) / 1.055) ** 2.4
    : channel / 12.92;
}

/** Uppercase `#RRGGBB`, the form email clients and `sharp` both want. */
export function oklchToHex(color: Oklch): string {
  const channels = toLinearRgb(color).map((channel) =>
    Math.round(Math.min(1, Math.max(0, encodeGamma(channel))) * 255),
  );
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

export function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  return [0, 2, 4].map((offset) =>
    parseInt(value.slice(offset, offset + 2), 16),
  ) as [number, number, number];
}

/** WCAG 2.2 relative luminance. */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((channel) => decodeGamma(channel / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.2 contrast ratio, 1–21. Order of the arguments does not matter. */
export function contrastRatio(a: string, b: string): number {
  const [lighter, darker] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (first, second) => second - first,
  );
  return (lighter + 0.05) / (darker + 0.05);
}

/** Composites `hex` at `alpha` over an opaque `backdrop`. */
export function blend(hex: string, alpha: number, backdrop: string): string {
  const source = hexToRgb(hex);
  const target = hexToRgb(backdrop);
  const mixed = source.map((channel, index) =>
    Math.round(channel * alpha + target[index] * (1 - alpha)),
  );
  return `#${mixed.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

/**
 * The same colour, darkened until it is readable on `backdrop`.
 *
 * Lightness comes down in small steps and hue and chroma are left alone, so
 * what comes back is recognisably the token it started from rather than a
 * second colour that happens to pass. Used for text roles whose token was
 * chosen as a fill — coral at `--primary` is a button, and the same coral as
 * 14px body copy on white is 2.8:1.
 */
export function darkenUntilReadable(
  color: Oklch,
  backdrop: string,
  minimumRatio: number,
): Oklch {
  const STEP = 0.005;
  let candidate = color;
  while (
    candidate.l > 0 &&
    contrastRatio(oklchToHex(candidate), backdrop) < minimumRatio
  ) {
    candidate = { ...candidate, l: Number((candidate.l - STEP).toFixed(3)) };
  }
  return candidate;
}

/**
 * Whether a colour can be shown on an sRGB screen as written.
 *
 * `toLinearRgb` clips, which is what a browser does to a colour it cannot
 * show — and browsers disagree on how: Chrome clips per channel, Safari
 * reduces chroma. A token is only the same colour everywhere if it never
 * needs either, so the palette generator asks this before it emits anything.
 * A hair of tolerance absorbs the rounding of the matrices themselves.
 */
export function isInGamut(color: Oklch, tolerance = 0.0005): boolean {
  const radians = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(radians);
  const b = color.c * Math.sin(radians);
  const long = (color.l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (color.l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (color.l - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ].every((channel) => channel >= -tolerance && channel <= 1 + tolerance);
}

/**
 * The same hue and lightness with just enough chroma taken off to fit sRGB.
 *
 * Chroma rather than lightness, because lightness is the thing the caller
 * chose — a text colour walked to 4.5:1 stops being 4.5:1 if it is then made
 * lighter to fit — and because a slightly duller coral is still coral where a
 * slightly lighter one is a different step of the ramp.
 */
export function fitChroma(color: Oklch): Oklch {
  const STEP = 0.002;
  let candidate = color;
  while (candidate.c > 0 && !isInGamut(candidate)) {
    candidate = {
      ...candidate,
      c: Number(Math.max(0, candidate.c - STEP).toFixed(3)),
    };
  }
  return candidate;
}

/** `oklch(0.712 0.168 30)` — the form `globals.css` and a `style` prop take. */
export function formatOklch({ l, c, h }: Oklch): string {
  const short = (value: number, digits: number) =>
    String(Number(value.toFixed(digits)));
  return `oklch(${short(l, 3)} ${short(c, 3)} ${short(h, 1)})`;
}

/**
 * Perceptual distance between two colours: Euclidean distance in OKLab, which
 * is the space OKLCH is the polar form of. Around 0.02 is the smallest step a
 * careful eye separates; two tokens meant to mean different things need a
 * good deal more than that.
 */
export function deltaE(a: Oklch, b: Oklch): number {
  const lab = ({ l, c, h }: Oklch) => {
    const radians = (h * Math.PI) / 180;
    return [l, c * Math.cos(radians), c * Math.sin(radians)];
  };
  const [la, aa, ba] = lab(a);
  const [lb, ab, bb] = lab(b);
  return Math.hypot(la! - lb!, aa! - ab!, ba! - bb!);
}

/** The shorter way round the hue circle, 0–180 degrees. */
export function hueDistance(a: number, b: number): number {
  const difference = Math.abs(((a - b) % 360) + 360) % 360;
  return difference > 180 ? 360 - difference : difference;
}

/**
 * The same colour walked in lightness until it reads on every one of the
 * `backdrops` at `minimumRatio` — down for a light theme, up for a dark one.
 *
 * `darkenUntilReadable` above is the one-backdrop, one-direction version the
 * email tokens are derived with; it is left alone so those hexes do not move.
 * This one checks several grounds at once, because an ink lands on the card,
 * on the page and on a wash of its own fill, and it is the worst of those
 * that decides; and it keeps every step inside sRGB, so the value it returns
 * is the value every browser shows.
 */
export function walkUntilReadable(
  color: Oklch,
  backdrops: readonly string[],
  minimumRatio: number,
  direction: "darker" | "lighter",
): Oklch {
  const STEP = 0.005;
  const readable = (candidate: Oklch) =>
    backdrops.every(
      (backdrop) =>
        contrastRatio(oklchToHex(candidate), backdrop) >= minimumRatio,
    );
  let candidate = fitChroma(color);
  while (
    !readable(candidate) &&
    (direction === "darker" ? candidate.l > 0 : candidate.l < 1)
  ) {
    const l = direction === "darker" ? candidate.l - STEP : candidate.l + STEP;
    candidate = fitChroma({
      ...candidate,
      l: Number(Math.min(1, Math.max(0, l)).toFixed(3)),
    });
  }
  return candidate;
}
