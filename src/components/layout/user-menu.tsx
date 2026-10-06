"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { PUSH } from "@/components/motion/transitions";
import { rememberOrigin } from "@/components/settings/settings-origin";
import { cn } from "@/lib/utils";
import { SidebarTip, useSidebar } from "./sidebar-context";

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
 *
 * `sidebar` draws it as the desktop sidebar's foot: the avatar, the name and
 * the word "Settings" under it, so the row says where it goes. Its name is
 * the reader's own followed by that word — still not a bare "Settings" for a
 * screen reader to confuse with the group's tab. Folded, it is the avatar,
 * with the same words as its name and its tip.
 */
export function UserMenu({
  label,
  isGuest,
  variant = "header",
}: {
  label: string;
  isGuest: boolean;
  variant?: "header" | "sidebar";
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

  if (variant === "sidebar") {
    return <SidebarAccount label={label} isGuest={isGuest} />;
  }

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

function SidebarAccount({
  label,
  isGuest,
}: {
  label: string;
  isGuest: boolean;
}) {
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const { collapsed } = useSidebar();

  const avatar = (
    <span
      aria-hidden="true"
      className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-medium text-accent-foreground"
    >
      {initialsOf(label)}
    </span>
  );
  const words = (secondary: string) => (
    <span
      className={cn(
        "flex min-w-0 flex-col leading-tight",
        collapsed && "sr-only",
      )}
    >
      <span className="truncate text-sm font-medium">{label}</span>
      <span className="truncate text-xs text-muted-foreground">
        {secondary}
      </span>
    </span>
  );

  if (isGuest) {
    return (
      <span
        className={cn(
          "flex min-w-0 items-center gap-2.5 px-1.5 py-1",
          collapsed ? "justify-center" : "flex-1",
        )}
      >
        {avatar}
        {words(tCommon("guest"))}
      </span>
    );
  }

  return (
    <SidebarTip content={`${label} · ${t("title")}`}>
      <Link
        href="/settings"
        transitionTypes={PUSH}
        onClick={rememberOrigin}
        // Heard as "Ada Lovelace, Settings", the two stacked lines with the
        // pause between them that the stacking only shows.
        aria-label={`${label}, ${t("title")}`}
        className={cn(
          "tap-target flex min-w-0 items-center rounded-[10px] transition-colors hover:bg-wash-2 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none",
          collapsed
            ? "mx-auto size-11 justify-center"
            : "flex-1 gap-2.5 px-1.5 py-1",
        )}
      >
        {avatar}
        {words(t("title"))}
      </Link>
    </SidebarTip>
  );
}
