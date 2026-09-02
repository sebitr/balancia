export type BalanceTone = "positive" | "negative" | "neutral";

/** Classify signed minor units without crossing a server/client boundary. */
export function toneFor(minorUnits: string | bigint): BalanceTone {
  const value =
    typeof minorUnits === "bigint" ? minorUnits : BigInt(minorUnits);
  if (value > 0n) return "positive";
  if (value < 0n) return "negative";
  return "neutral";
}

export interface ToneStyle {
  /** The figure, the link, the word — text, at 4.5:1 wherever it lands. */
  readonly ink: string;
  /** The bar or the badge — a graphical object, held to 3:1. */
  readonly fill: string;
  /** The wash a badge or chip sits on, with `ink` on top of it. */
  readonly tint: string;
  /** The arithmetic sign that goes in front of the magnitude. */
  readonly sign: "+" | "−";
  /** The word in the `money` namespace that says it without colour. */
  readonly labelKey: "getsBack" | "owes" | "settledUp";
}

/**
 * What each tone is drawn with, in one place.
 *
 * Ten components used to carry their own copy of this record, and two of
 * them had drifted — one washed its tile at `/10` where the rest used `/15`,
 * another set a figure in the *fill* colour, which is a bar's colour and
 * reads 2.6:1 as text on cream. The tokens themselves move with the accent
 * (see `src/modules/profile/money-tones.ts`); the classes never do, so this
 * is the only mapping a balance needs, and `src/app/token-contrast.test.ts`
 * holds every ink here to its ratio on every surface the tint puts it on.
 *
 * The neutral tone washes with `bg-muted` rather than a colour of its own:
 * settled is the absence of a direction, and a grey tint says so better than
 * a fourth colour would.
 */
export const TONE: Record<BalanceTone, ToneStyle> = {
  positive: {
    ink: "text-positive-ink",
    fill: "bg-positive",
    tint: "bg-positive/15",
    sign: "+",
    labelKey: "getsBack",
  },
  negative: {
    ink: "text-negative-ink",
    fill: "bg-negative",
    tint: "bg-negative/15",
    sign: "−",
    labelKey: "owes",
  },
  neutral: {
    ink: "text-neutral-balance-ink",
    fill: "bg-neutral-balance",
    tint: "bg-muted",
    sign: "−",
    labelKey: "settledUp",
  },
};
