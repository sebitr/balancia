import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { CurrencyRow } from "@/components/settings/currency-row";
import { FormatChoices } from "@/components/settings/format-choices";
import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("money") };
}

/**
 * The currency totals are shown in, and how dates and amounts are written.
 *
 * Three separate decisions that live together because they are all about
 * notation rather than about money: none of them touches a stored amount or a
 * frozen exchange rate, and every one of them changes only what the reader
 * sees.
 */
export default async function MoneySettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const currency = await getUserPreferredCurrency(user.userId);

  return (
    <SettingsScreen
      title={t("money")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      {/* An account that has never chosen one is shown the fallback the
          dashboard already totals in, rather than an empty row. */}
      <CurrencyRow current={currency ?? "EUR"} />

      <FormatChoices />

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("formatsNote")}
      </p>
    </SettingsScreen>
  );
}
