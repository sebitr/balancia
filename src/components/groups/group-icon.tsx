import {
  Bike,
  Car,
  Coffee,
  Gift,
  Heart,
  House,
  Luggage,
  Music,
  PartyPopper,
  Plane,
  ShoppingCart,
  Star,
  Tent,
  Utensils,
  Volleyball,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DEFAULT_GROUP_ICON_COLOR,
  type GroupIcon as GroupIconName,
  type GroupIconColor,
} from "@/modules/groups/icons";

/**
 * How a group's chosen icon is drawn.
 *
 * The accent arrives as a CSS variable rather than a colour value so the two
 * themes can disagree about it — see `--group-accent-*` in globals.css — and
 * so a tint can be mixed from it at the point of use without either theme
 * having to enumerate the mixtures.
 */

export const GROUP_ICON_GLYPHS: Record<GroupIconName, LucideIcon> = {
  plane: Plane,
  luggage: Luggage,
  house: House,
  tent: Tent,
  car: Car,
  cart: ShoppingCart,
  coffee: Coffee,
  meal: Utensils,
  party: PartyPopper,
  gift: Gift,
  music: Music,
  sport: Volleyball,
  bike: Bike,
  heart: Heart,
  star: Star,
};

/** The custom property holding this accent in the active theme. */
export function groupAccent(color: GroupIconColor | null | undefined): string {
  return `var(--group-accent-${color ?? DEFAULT_GROUP_ICON_COLOR})`;
}

/**
 * A group's icon on its tinted tile, or its initial when it has no icon.
 *
 * One component for every size it appears at — 52px beside the name field,
 * 64px above the picker, 40px in the dashboard list — because the tint, the
 * stroke weight and the fallback have to agree in all three.
 */
export function GroupIconTile({
  icon,
  color,
  name,
  className,
  iconClassName,
}: {
  icon: GroupIconName | null;
  color: GroupIconColor | null;
  /** Supplies the initial shown when there is no icon. */
  name?: string;
  className?: string;
  iconClassName?: string;
}) {
  const accent = groupAccent(color);
  const Glyph = icon ? GROUP_ICON_GLYPHS[icon] : null;
  const initial = name?.trim().slice(0, 1).toUpperCase();

  return (
    <span
      aria-hidden="true"
      data-slot="group-icon-tile"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xl",
        className,
      )}
      style={{
        background: Glyph
          ? `color-mix(in oklch, ${accent} 20%, transparent)`
          : undefined,
        color: Glyph ? accent : undefined,
      }}
    >
      {Glyph ? (
        <Glyph
          strokeWidth={1.6}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn("size-6", iconClassName)}
        />
      ) : (
        <span className="font-medium">{initial}</span>
      )}
    </span>
  );
}
