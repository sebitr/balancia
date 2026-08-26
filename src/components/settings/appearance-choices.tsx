"use client";

import { useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { toastUndoable } from "@/components/ui/sonner";
import { AccentChoices } from "./accent-choices";
import { ChoiceCard } from "./choice-card";
import { ThemeCards, type ThemeChoice } from "./theme-cards";
import { setLocaleAction } from "@/i18n/actions";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALES,
  LOCALE_LABELS,
  type AppLocale,
} from "@/i18n/locales";
import type { AccentColor } from "@/modules/profile/accent";

/**
 * Theme, accent and language — how the app looks and reads to you.
 *
 * Three decisions on one screen and three different places to keep them, which
 * is why this is one client component rather than three.
 *
 * The theme lives in the browser: `next-themes` owns it, writes it to local
 * storage and applies it before paint. Nothing is sent anywhere, so nothing can
 * fail and there is no toast — the ring moving, and the page changing colour
 * under it, is the confirmation.
 *
 * The accent is a cookie and an account column, and paints itself before it is
 * written; `AccentChoices` explains why.
 *
 * The language is on the account, so it is written, and the whole page is
 * re-rendered afterwards because every visible string came from the server.
 * That one *can* fail and that one *is* worth a way back: the list is in the
 * language you just left, and finding your way home from a language you cannot
 * read is exactly the trap Undo exists for.
 */
const subscribeToNothing = () => () => {};

export function AppearanceChoices({ accent }: { accent: AccentColor }) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const tCommon = useTranslations("common");
  const { theme, setTheme } = useTheme();
  const requested = useLocale();
  const [isPending, startTransition] = useTransition();

  const mounted = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const locale = isAppLocale(requested) ? requested : DEFAULT_LOCALE;

  const choose = (next: AppLocale, announce = true) => {
    if (next === locale && announce) return;
    const previous = locale;
    startTransition(async () => {
      // The action writes a cookie and, for a signed-in reader, the account.
      // It has no failure to report — an unknown locale is ignored rather
      // than refused — so there is nothing to check and nothing to roll back.
      await setLocaleAction(next);
      if (announce) {
        toastUndoable(
          t("languageSaved"),
          { label: tCommon("undo"), onUndo: () => choose(previous, false) },
          { id: "app-locale" },
        );
      }
      router.refresh();
    });
  };

  return (
    <>
      <ThemeCards
        label={t("theme")}
        // Before the provider has read storage the choice is unknown. Ringing
        // "Auto" would be a guess that marks the wrong card for anybody who
        // chose otherwise, so nothing is ringed until it is known.
        value={mounted ? ((theme ?? "system") as ThemeChoice) : null}
        choices={{
          system: {
            label: t("themeSystem"),
            description: t("themeSystemHelp"),
          },
          light: { label: t("themeLight"), description: t("themeLightHelp") },
          dark: { label: t("themeDark"), description: t("themeDarkHelp") },
        }}
        onChoose={(next) => setTheme(next)}
        disabled={!mounted}
      />

      <AccentChoices current={accent} />

      <ChoiceCard
        name="language"
        label={t("language")}
        value={locale}
        choices={LOCALES.map((one) => ({
          value: one,
          label: LOCALE_LABELS[one],
        }))}
        onChoose={(next) => choose(next)}
        disabled={isPending}
      />

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("languageNote")}
      </p>
    </>
  );
}
