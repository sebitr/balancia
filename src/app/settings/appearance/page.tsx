import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { AppearanceChoices } from "@/components/settings/appearance-choices";
import { resolveAccentColor } from "@/i18n/preferences";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("appearance") };
}

/**
 * How the app looks and which language it speaks.
 *
 * The theme and the language are settled in the browser as far as this page is
 * concerned — the theme entirely, the language through an action the client
 * component owns. The accent is the one thing the server has to hand down: it
 * is already painted on the document root by the root layout, and the picker
 * needs the name behind that colour to ring the right swatch on the first
 * paint rather than a beat later.
 */
export default async function AppearanceSettingsPage() {
  const t = await getTranslations("userSettings");
  const accent = await resolveAccentColor();

  return (
    <SettingsScreen
      title={t("appearance")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <AppearanceChoices accent={accent} />
    </SettingsScreen>
  );
}
