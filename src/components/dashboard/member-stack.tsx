import { useTranslations } from "next-intl";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

/**
 * Overlapping initials, one letter each.
 *
 * A single letter is not a stylistic choice: at 20px the next avatar in the
 * overlap clips a second one. The whole stack carries one label naming the
 * people, so a screen reader reads "Sofia, Mika and 4 others" rather than a
 * run of stray letters.
 */
export function MemberStack({
  names,
  total,
}: {
  names: readonly string[];
  total: number;
}) {
  const t = useTranslations("dashboard");

  // Beyond three people the last slot becomes a counter, so it stops being a
  // name and starts being "and the rest".
  const overflow = total - names.length;
  const shown = overflow > 0 ? names.slice(0, names.length - 1) : names;
  const counter = total - shown.length;

  const label =
    counter > 0
      ? t("membersWithOthers", { names: shown.join(", "), count: counter })
      : t("members", { names: shown.join(", ") });

  return (
    <span
      role="img"
      aria-label={label}
      className="flex shrink-0 -space-x-1.5 *:ring-2 *:ring-background"
    >
      {shown.map((name, index) => (
        <Avatar key={`${name}-${index}`} className="size-5">
          <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
            {name.trim().charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
      ))}
      {counter > 0 && (
        // A circle while the count is one digit, a stadium once it is two.
        // The avatars beside it are always a single letter and stay round; a
        // fixed `size-5` here put `+12` over its own edge.
        <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-0.5 text-2xs font-semibold text-accent-foreground ring-2 ring-background">
          +{counter}
        </span>
      )}
    </span>
  );
}
