/**
 * The icon and accent a group may be given.
 *
 * Both are stored as slugs rather than positions in this list. An index would
 * silently repoint every existing group the first time somebody reorders the
 * catalogue or drops an icon from it; a slug either resolves or it does not.
 *
 * The lists are the single source of truth for the picker, the tile and the
 * Zod schemas, so adding an icon here is the whole change. The database
 * deliberately checks only the shape of a slug, not its membership — pinning
 * the catalogue in a constraint would put a migration in front of every new
 * icon, the same reason `base_currency` is checked as `^[A-Z]{3}$` rather than
 * against the ISO 4217 list.
 */

export const GROUP_ICONS = [
  "plane",
  "luggage",
  "house",
  "tent",
  "car",
  "cart",
  "coffee",
  "meal",
  "party",
  "gift",
  "music",
  "sport",
  "bike",
  "heart",
  "star",
] as const;

export type GroupIcon = (typeof GROUP_ICONS)[number];

/**
 * Accents are named, not stored as colour values, so the palette can be
 * retuned — or given light-theme variants — without rewriting stored rows.
 */
export const GROUP_ICON_COLORS = [
  "coral",
  "emerald",
  "amber",
  "plum",
  "blue",
] as const;

export type GroupIconColor = (typeof GROUP_ICON_COLORS)[number];

/** Coral is the brand accent, and the one a group gets if nobody chooses. */
export const DEFAULT_GROUP_ICON_COLOR: GroupIconColor = "coral";

export function isGroupIcon(value: unknown): value is GroupIcon {
  return (
    typeof value === "string" &&
    (GROUP_ICONS as readonly string[]).includes(value)
  );
}

export function isGroupIconColor(value: unknown): value is GroupIconColor {
  return (
    typeof value === "string" &&
    (GROUP_ICON_COLORS as readonly string[]).includes(value)
  );
}
