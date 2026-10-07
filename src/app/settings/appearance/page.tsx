import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";
import {
  areSingleKeysOn,
  SINGLE_KEYS_COOKIE_NAME,
} from "@/components/layout/single-keys";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { AppearanceChoices } from "@/components/settings/appearance-choices";
import { SingleKeyShortcuts } from "@/components/settings/single-key-shortcuts";
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
 *
 * Last, and from `lg` up only, the switch for N and S — a fact about this
 * device's keyboard, read from its cookie so it is drawn the way it stands.
 */
export default async function AppearanceSettingsPage() {
  const [t, accent, surfaces, favorites, cookieStore] = await Promise.all([
    getTranslations("userSettings"),
    resolveAccentColor(),
    resolveSurfacePreferences(),
    resolveCurrencyFavorites(),
    cookies(),
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
      <SingleKeyShortcuts
        initialOn={areSingleKeysOn(
          cookieStore.get(SINGLE_KEYS_COOKIE_NAME)?.value,
        )}
      />
    </SettingsScreen>
  );
}
