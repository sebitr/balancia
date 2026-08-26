"use client";

import { useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Moon } from "lucide-react";
import { SettingsLinkRow } from "./settings-row";

/**
 * The one hub row whose summary the server cannot write.
 *
 * `next-themes` keeps the theme in local storage and reads it from a script
 * that runs before paint, so the server has no idea which one this is. The row
 * therefore arrives carrying the accent dot alone and names the theme a beat
 * later — the same bargain `ThemeToggle` makes, and for the same reason: the
 * alternative is guessing on the server and repainting the whole page when the
 * guess is wrong.
 *
 * The theme *choice* is what is named, not what it resolved to. Somebody who
 * asked to follow their phone wants to read "Match my phone", not whichever of
 * light and dark their phone happens to be in this evening.
 *
 * The language is deliberately not here, though the screen behind the row also
 * holds it. Three facts do not fit beside a label this long, and of the three
 * the language is the one already legible everywhere else on the page — the
 * reader is looking at it.
 *
 * The accent needs no such care and is not passed in: the dot is painted with
 * the live `--primary`, which the server already set on the document root, so
 * it is right in the first frame and stays right the moment somebody changes
 * it on the screen this row leads to.
 */
const subscribeToNothing = () => () => {};

export function AppearanceSummary() {
  const t = useTranslations("userSettings");
  const { theme } = useTheme();

  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const themeLabel =
    theme === "light"
      ? t("themeLight")
      : theme === "dark"
        ? t("themeDark")
        : t("themeSystem");

  return (
    <SettingsLinkRow
      href="/settings/appearance"
      icon={Moon}
      label={t("appearance")}
      trailing={
        <span className="flex min-w-0 shrink items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-primary"
          />
          {mounted && <span className="truncate">{themeLabel}</span>}
        </span>
      }
    />
  );
}
