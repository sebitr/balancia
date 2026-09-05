"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { AccentChoices } from "./accent-choices";
import { AppearancePreview } from "./appearance-preview";
import { ChoiceCard } from "./choice-card";
import { SurfaceChoices } from "./surface-choices";
import { setLocaleAction } from "@/i18n/actions";
import {
  DEFAULT_LOCALE,
  isAppLocale,
  LOCALES,
  LOCALE_LABELS,
  type AppLocale,
} from "@/i18n/locales";
import type { AccentColor } from "@/modules/profile/accent";
import type { SurfacePreferences } from "@/modules/profile/surface";

/**
 * How the app looks and reads to you: a preview, then the choices that
 * change it.
 *
 * Four kinds of decision on one screen and three different places to keep
 * them. The theme lives in the browser and the surfaces in cookies —
 * `SurfaceChoices` explains both. The accent is a cookie and an account
 * column, and paints itself before it is written; `AccentChoices` explains
 * why.
 *
 * The language is on the account, so it is written, and the whole page is
 * re-rendered afterwards because every visible string came from the server.
 * It confirms itself the way the accent and the surfaces do — the tick moves,
 * every word on the screen is in the new language, and the row above or below
 * puts it back in one tap. That row is legible whatever was just chosen:
 * `LOCALE_LABELS` names each language in itself, so "English" reads as English
 * from a French screen. A toast over the top would have covered the heading to
 * say what the screen underneath had already said.
 */
export function AppearanceChoices({
  accent,
  surfaces,
  currency,
}: {
  accent: AccentColor;
  surfaces: SurfacePreferences;
  /** What the preview's figures are written in. */
  currency: string;
}) {
  const router = useRouter();
  const t = useTranslations("userSettings");
  const requested = useLocale();
  const [isPending, startTransition] = useTransition();

  const locale = isAppLocale(requested) ? requested : DEFAULT_LOCALE;

  const choose = (next: AppLocale) => {
    if (next === locale) return;
    startTransition(async () => {
      // The action writes a cookie and, for a signed-in reader, the account.
      // It has no failure to report — an unknown locale is ignored rather
      // than refused — so there is nothing to check and nothing to roll back.
      await setLocaleAction(next);
      router.refresh();
    });
  };

  return (
    <>
      <AppearancePreview currency={currency} />

      <SurfaceChoices current={surfaces} />

      <AccentChoices current={accent} />

      <ChoiceCard
        name="language"
        label={t("language")}
        value={locale}
        choices={LOCALES.map((one) => ({
          value: one,
          label: LOCALE_LABELS[one],
        }))}
        onChoose={choose}
        disabled={isPending}
      />

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("languageNote")}
      </p>
    </>
  );
}
