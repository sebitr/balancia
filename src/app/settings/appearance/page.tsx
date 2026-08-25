import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { AppearanceChoices } from "@/components/settings/appearance-choices";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("appearance") };
}

/**
 * How the app looks and which language it speaks.
 *
 * Both choices are made in the browser as far as this page is concerned — the
 * theme entirely, the language through an action the client component owns —
 * so the page itself is only the frame around them.
 */
export default async function AppearanceSettingsPage() {
  const t = await getTranslations("userSettings");

  return (
    <SettingsScreen
      title={t("appearance")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <AppearanceChoices />
    </SettingsScreen>
  );
}
