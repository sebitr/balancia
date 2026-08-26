"use client";

import { useSyncExternalStore } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { Moon } from "lucide-react";
import { SettingsLinkRow } from "./settings-row";
import { DEFAULT_LOCALE, isAppLocale, LOCALE_LABELS } from "@/i18n/locales";

/**
 * The one hub row whose summary the server cannot write.
 *
 * Language comes from a cookie and is rendered with everything else; the theme
 * does not — `next-themes` keeps the choice in local storage, and reads it from
 * a script that runs before paint. So this row arrives showing the language
 * alone and gains "Dark · " a beat later, which is the same bargain
 * `ThemeToggle` makes and for the same reason: the alternative is guessing on
 * the server and repainting the whole page when the guess is wrong.
 *
 * The theme *choice* is what is named, not what it resolved to. Somebody who
 * asked to follow their phone wants to read "Match my phone", not whichever of
 * light and dark their phone happens to be in this evening.
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
  const locale = useLocale();

  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const language = LOCALE_LABELS[isAppLocale(locale) ? locale : DEFAULT_LOCALE];

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
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span
            aria-hidden="true"
            className="size-2 shrink-0 rounded-full bg-primary"
          />
          <span className="truncate">
            {mounted ? `${themeLabel} · ${language}` : language}
          </span>
        </span>
      }
    />
  );
}
