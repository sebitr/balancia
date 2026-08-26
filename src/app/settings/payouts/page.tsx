import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { PayoutMethodsCard } from "@/components/payouts/payout-methods-card";
import { getCurrentUser } from "@/lib/security/actor";
import { getPayoutAddress, listPayoutMethods } from "@/modules/payouts/service";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("payouts");
  return { title: t("title") };
}

/**
 * How you want to be paid back.
 *
 * Its own screen, rather than the last card on the notation one. Those two
 * questions only ever shared a page because both had the word "money" in them:
 * one is about how a number is punctuated, this is about a stranger opening
 * their banking app and typing what you wrote down. Promoting it also gives
 * the hub a row that can say, at a glance, which methods are on the account —
 * which is the question people actually open settings to check.
 *
 * The screen says who sees this, and says it before the fields rather than
 * under them: these details are readable by exactly the people who owe their
 * owner money, and somebody should know that before typing an IBAN, not after.
 */
export default async function PayoutsSettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("payouts");
  const tSettings = await getTranslations("userSettings");
  const [methods, address] = await Promise.all([
    listPayoutMethods(user.userId),
    getPayoutAddress(user.userId),
  ]);

  return (
    <SettingsScreen
      title={t("title")}
      back={{ href: "/settings", label: tSettings("backToSettings") }}
    >
      <div className="shrink-0 space-y-0.5 px-1.5 text-xs leading-relaxed text-pretty">
        <p>{t("intro")}</p>
        <p className="text-muted-foreground">{t("introPrivacy")}</p>
      </div>

      <PayoutMethodsCard initial={methods} initialAddress={address} />
    </SettingsScreen>
  );
}
