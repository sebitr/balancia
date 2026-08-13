import { containsTokenRun, indexOfTokenRun, tokenize } from "./normalize";
import type { ExpenseCategory } from "./types";

/**
 * Contextual overrides.
 *
 * A handful of merchants sell across categories, and for them the *rest* of
 * the text is what decides. These rules run before generic merchant matching
 * and, where the answer is genuinely settled, suppress the categories they
 * rule out so a stale hint cannot come second and spoil the margin.
 *
 * Payment processors are not here: `normalizeMerchant` strips them and hands
 * back the merchant behind them, so PayPal, Stripe, SumUp and Square are
 * never classified as anything at all.
 */

export interface OverrideMatch {
  readonly category: ExpenseCategory;
  /** What the rule keyed on, for the explanation. */
  readonly token: string;
  /** Categories whose seed evidence this rule rules out. */
  readonly suppress: readonly ExpenseCategory[];
}

interface OverrideContext {
  /** Tokens of the normalized merchant. */
  readonly merchant: readonly string[];
  /** Tokens of merchant, description, note and receipt text together. */
  readonly text: readonly string[];
}

const APPLE_SUBSCRIPTION_MARKERS = [
  "apple.com/bill",
  "apple com bill",
  "icloud",
  "apple music",
  "apple tv",
  "apple one",
].map(tokenize);

const APPLE_HARDWARE_MARKERS = [
  "store",
  "iphone",
  "ipad",
  "macbook",
  "mac",
  "watch",
  "airpods",
].map(tokenize);

const AMAZON_SUBSCRIPTION_MARKERS = ["prime", "prime membership"].map(tokenize);

const UBER_EATS_MARKERS = ["uber eats", "ubereats"].map(tokenize);

/** Filling-station brands. Ambiguous until the text mentions what was bought. */
const FUEL_BRANDS = [
  "shell",
  "bp",
  "esso",
  "avia",
  "tamoil",
  "migrol",
  "eni",
  "agrola",
  "coop pronto",
  "socar",
  "total",
  "totalenergies",
].map(tokenize);

const FUEL_MARKERS = [
  "fuel",
  "petrol",
  "gasoline",
  "diesel",
  "carburant",
  "essence",
  "sans plomb",
  "unleaded",
  "benzin",
].map(tokenize);

function hasAny(
  tokens: readonly string[],
  phrases: readonly (readonly string[])[],
): readonly string[] | null {
  for (const phrase of phrases) {
    if (containsTokenRun(tokens, phrase)) return phrase;
  }
  return null;
}

/** True when the merchant *opens* with one of these brands. */
function startsWithAny(
  tokens: readonly string[],
  phrases: readonly (readonly string[])[],
): readonly string[] | null {
  for (const phrase of phrases) {
    if (indexOfTokenRun(tokens, phrase) === 0) return phrase;
  }
  return null;
}

export function contextualOverrides(
  context: OverrideContext,
): readonly OverrideMatch[] {
  const { merchant, text } = context;
  const matches: OverrideMatch[] = [];

  // Apple: the same name bills a phone and a music subscription.
  if (merchant.includes("apple") || text.includes("apple")) {
    const subscription = hasAny(text, APPLE_SUBSCRIPTION_MARKERS);
    const hardware = hasAny(text, APPLE_HARDWARE_MARKERS);
    if (subscription) {
      matches.push({
        category: "subscriptions",
        token: `apple ${subscription.join(" ")}`,
        suppress: ["shopping"],
      });
    } else if (hardware) {
      matches.push({
        category: "shopping",
        token: `apple ${hardware.join(" ")}`,
        suppress: ["subscriptions"],
      });
    }
  }

  // Amazon: Prime is a subscription, everything else is a hint at best —
  // Amazon Fresh is groceries and the classifier must not pretend otherwise.
  if (merchant.includes("amazon") || text.includes("amazon")) {
    const subscription = hasAny(text, AMAZON_SUBSCRIPTION_MARKERS);
    if (subscription) {
      matches.push({
        category: "subscriptions",
        token: `amazon ${subscription.join(" ")}`,
        suppress: ["shopping"],
      });
    }
  }

  // Uber: the ride company and the delivery company share a name.
  const uberEats = hasAny(text, UBER_EATS_MARKERS);
  if (uberEats) {
    matches.push({
      category: "restaurants",
      token: uberEats.join(" "),
      suppress: ["transport"],
    });
  }

  // Filling stations: fuel is transport, a sandwich is not.
  const fuelBrand = startsWithAny(merchant, FUEL_BRANDS);
  if (fuelBrand && hasAny(text, FUEL_MARKERS)) {
    matches.push({
      category: "transport",
      token: `${fuelBrand.join(" ")} fuel`,
      suppress: ["groceries"],
    });
  }

  return matches;
}
