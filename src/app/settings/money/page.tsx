import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { CurrencyRow } from "@/components/settings/currency-row";
import { FormatChoices } from "@/components/settings/format-choices";
import { SettingsCard } from "@/components/settings/settings-card";
import { PayoutMethodsForm } from "@/components/payouts/payout-methods-form";
import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { listPayoutMethods } from "@/modules/payouts/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("money") };
}

/**
 * The currency totals are shown in, and how dates and amounts are written.
 *
 * The first three are about notation rather than about money: none of them
 * touches a stored amount or a frozen exchange rate, and every one changes only
 * what the reader sees.
 *
 * The fourth is the exception and is here because it is the other thing on this
 * screen that money moves through: how somebody wants to be paid back. Unlike
 * the rest of settings it waits for its write and reports failure — an IBAN
 * that quietly did not save is discovered by the money not arriving.
 */
export default async function MoneySettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const tPayouts = await getTranslations("payouts");
  const [currency, payouts] = await Promise.all([
    getUserPreferredCurrency(user.userId),
    listPayoutMethods(user.userId),
  ]);

  return (
    <SettingsScreen
      title={t("money")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      {/* An account that has never chosen one is shown the fallback the
          dashboard already totals in, rather than an empty row. */}
      <CurrencyRow current={currency ?? "EUR"} />

      <FormatChoices />

      {/* Payout details sit with the currencies rather than on the account
          screen: this is about money moving, not about who you are. */}
      <SettingsCard title={tPayouts("title")} description={tPayouts("sub")}>
        <PayoutMethodsForm initial={payouts} />
      </SettingsCard>

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("formatsNote")}
      </p>
    </SettingsScreen>
  );
}
