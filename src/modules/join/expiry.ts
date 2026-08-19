/**
 * How long the group's join link lasts.
 *
 * Four choices, because the question behind them is not "how many days" but
 * "is this a weekend, a holiday, or the group I am in forever" — and a reader
 * who has to invent a number answers it worse than one who picks. A week is
 * the default: long enough for the stragglers in the chat, short enough that a
 * link pasted into a workplace channel does not stay open all year.
 *
 * Changing the choice moves the date and leaves the token alone, so extending
 * a link never breaks the URL the group already has.
 *
 * Pure on purpose: both the screens and the Server Actions read this, and the
 * arithmetic is the same on either side of the wire.
 */

export const JOIN_LINK_EXPIRY_CHOICES = [
  "day",
  "week",
  "month",
  "never",
] as const;

export type JoinLinkExpiryChoice = (typeof JOIN_LINK_EXPIRY_CHOICES)[number];

export const DEFAULT_JOIN_LINK_EXPIRY: JoinLinkExpiryChoice = "week";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const DURATIONS: Record<Exclude<JoinLinkExpiryChoice, "never">, number> = {
  day: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

export function isExpiryChoice(value: unknown): value is JoinLinkExpiryChoice {
  return (
    typeof value === "string" &&
    (JOIN_LINK_EXPIRY_CHOICES as readonly string[]).includes(value)
  );
}

/** When a link chosen now would lapse. Null means it never does. */
export function expiryDate(
  choice: JoinLinkExpiryChoice,
  now: Date = new Date(),
): Date | null {
  return choice === "never"
    ? null
    : new Date(now.getTime() + DURATIONS[choice]);
}

/** How much of a link is left, in the units a person would say it in. */
export type Remaining =
  | { readonly kind: "never" }
  | { readonly kind: "expired" }
  | { readonly kind: "hours"; readonly count: number }
  | { readonly kind: "days"; readonly count: number };

/**
 * Rounds up, always. A link with eleven hours left is open for the rest of
 * today, and "In 11 hours" is what somebody deciding whether to extend it
 * needs to hear; rounding down to ten would be pessimistic about a value the
 * reader will compare against a clock.
 */
export function remainingFor(
  expiresAt: Date | null,
  now: Date = new Date(),
): Remaining {
  if (expiresAt === null) return { kind: "never" };
  const left = expiresAt.getTime() - now.getTime();
  if (left <= 0) return { kind: "expired" };
  // Under two days the answer is hours: "In 1 day" reads as tomorrow morning
  // when the link in fact dies tonight.
  if (left < 2 * DAY_MS) {
    return { kind: "hours", count: Math.ceil(left / HOUR_MS) };
  }
  return { kind: "days", count: Math.ceil(left / DAY_MS) };
}
