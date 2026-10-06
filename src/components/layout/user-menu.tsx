"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PUSH } from "@/components/motion/transitions";
import { rememberOrigin } from "@/components/settings/settings-origin";
import { cn } from "@/lib/utils";

function initialsOf(label: string): string {
  const parts = label.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

/**
 * The avatar in the header, and what happens when it is pressed.
 *
 * It used to open a dropdown of nine things: the profile, notifications,
 * security, administration, the install prompt, both languages and sign out.
 * A menu is a list of destinations that has to be read before any of them can
 * be chosen, and this one had grown long enough that finding the language
 * switcher meant reading past four links to pages.
 *
 * So it is a link now, and the list it used to hold is the settings hub —
 * where each row can carry its current value, which is the thing a dropdown
 * cannot do and the reason most visits to it were only ever to check
 * something.
 *
 * A guest has no account behind the avatar and never had a menu; they get the
 * same initials and their name, which is all the dropdown ever showed them.
 *
 * Pressing it remembers the screen it was pressed on, so that the hub's ✕
 * comes back here rather than to the dashboard (see `settings-origin.ts`).
 */
export function UserMenu({
  label,
  isGuest,
}: {
  label: string;
  isGuest: boolean;
}) {
  // Named for whose it is, not "Settings": inside a group the tab bar already
  // has a Settings, for the group's, and a screen reader listing the links on
  // the page met two of them leading to different places.
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");

  const initials = (
    <span
      className={cn(
        "flex size-7 items-center justify-center rounded-full",
        "bg-accent text-2xs font-medium text-accent-foreground",
      )}
    >
      {initialsOf(label)}
    </span>
  );

  if (isGuest) {
    return (
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        {initials}
        <span className="hidden sm:inline">
          {label} · {tCommon("guest")}
        </span>
      </span>
    );
  }

  return (
    <Link
      href="/settings"
      transitionTypes={PUSH}
      onClick={rememberOrigin}
      aria-label={t("yourAccount")}
      className="tap-target flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {initials}
      <span className="hidden max-w-32 truncate text-sm font-medium sm:inline">
        {label}
      </span>
    </Link>
  );
}
