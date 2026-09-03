import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { AppearanceChoices } from "@/components/settings/appearance-choices";
import {
  resolveAccentColor,
  resolveSurfacePreferences,
} from "@/i18n/preferences";
import { resolveCurrencyFavorites } from "@/modules/currencies/preferences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("appearance") };
}

/**
 * How the app looks and which language it speaks.
 *
 * The theme and the language are settled in the browser as far as this page is
 * concerned — the theme entirely, the language through an action the client
 * component owns. The accent, the surfaces and the contrast are the things
 * the server has to hand down: they are already on the document root from
 * the root layout, and the pickers need the names behind them to ring the
 * right swatch on the first paint rather than a beat later.
 *
 * The preview writes its figures in the reader's first starred currency,
 * so the card looks like their own rather than somebody else's.
 */
export default async function AppearanceSettingsPage() {
  const [t, accent, surfaces, favorites] = await Promise.all([
    getTranslations("userSettings"),
    resolveAccentColor(),
    resolveSurfacePreferences(),
    resolveCurrencyFavorites(),
  ]);

  return (
    <SettingsScreen
      title={t("appearance")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <AppearanceChoices
        accent={accent}
        surfaces={surfaces}
        currency={favorites.favorites[0] ?? "EUR"}
      />
    </SettingsScreen>
  );
}
