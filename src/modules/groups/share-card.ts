import { oklchToHex, type Oklch } from "@/lib/color/oklch";
import {
  DEFAULT_GROUP_ICON_COLOR,
  isGroupIcon,
  type GroupIcon,
  type GroupIconColor,
} from "./icons";

/**
 * The picture a join link puts in a chat bubble.
 *
 * Two things decide it and nothing else: which icon the group wears and in
 * which accent. Both are in the URL, which is the whole point — the card is
 * served from `/join/og/<accent>/<icon>`, a path with no token and no group
 * id in it, so the image a crawler fetches and caches on somebody else's CDN
 * says only what the bubble is about to show anyway.
 *
 * The group's *name* is deliberately not in the picture. It reaches the
 * bubble through `og:title` instead, in the document that only a holder of
 * the token is served — and keeping it out is what leaves this a fixed set of
 * seventy-five images rather than one per group, cacheable forever.
 */

/** Where every card is served from. `proxy.ts` reads this too. */
export const SHARE_CARD_PREFIX = "/join/og";

/** The slug standing in for a group that chose no icon. */
export const NO_SHARE_CARD_ICON = "none";

export type ShareCardIcon = GroupIcon | typeof NO_SHARE_CARD_ICON;

export function isShareCardIcon(value: unknown): value is ShareCardIcon {
  return value === NO_SHARE_CARD_ICON || isGroupIcon(value);
}

/**
 * The accents as colour values, which is the one place they are allowed to be.
 *
 * Satori resolves no custom properties, so `var(--group-accent-…)` — how every
 * other surface asks for these — reaches the renderer as nothing. These are
 * the *dark* theme's values, because the card is drawn on the dark ground, and
 * `share-card.test.ts` re-derives all five from `globals.css` on every run:
 * retune a token and the test names the constant that stopped following it,
 * rather than leaving one accent slightly wrong in a bubble for a year. Same
 * arrangement, and same reason, as the email palette in
 * `src/modules/auth/emails/tokens.ts`.
 */
export const SHARE_CARD_ACCENTS: Record<GroupIconColor, Oklch> = {
  coral: { l: 0.712, c: 0.168, h: 30 },
  emerald: { l: 0.75, c: 0.13, h: 167 },
  amber: { l: 0.78, c: 0.13, h: 70 },
  plum: { l: 0.71, c: 0.048, h: 319 },
  blue: { l: 0.68, c: 0.12, h: 250 },
};

export function shareCardAccent(color: GroupIconColor): string {
  return oklchToHex(SHARE_CARD_ACCENTS[color]);
}

/** Where the card for a group's decoration is served from. */
export function shareCardPath(
  icon: GroupIcon | null | undefined,
  color: GroupIconColor | null | undefined,
): string {
  return `${SHARE_CARD_PREFIX}/${color ?? DEFAULT_GROUP_ICON_COLOR}/${icon ?? NO_SHARE_CARD_ICON}`;
}

/** What `og:image:width` and `og:image:height` claim. */
export const SHARE_CARD_SIZE = { width: 1200, height: 630 } as const;
