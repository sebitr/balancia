export type BalanceTone = "positive" | "negative" | "neutral";

/** Classify signed minor units without crossing a server/client boundary. */
export function toneFor(minorUnits: string): BalanceTone {
  const value = BigInt(minorUnits);
  if (value > 0n) return "positive";
  if (value < 0n) return "negative";
  return "neutral";
}
