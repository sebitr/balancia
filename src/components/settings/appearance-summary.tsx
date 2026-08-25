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
      summary={mounted ? `${themeLabel} · ${language}` : language}
    />
  );
}
