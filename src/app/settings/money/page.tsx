import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettingsScreen } from "@/components/settings/settings-screen";
import {
  MoneyFormats,
  type PreviewEntry,
} from "@/components/settings/money-formats";
import { getCurrentUser } from "@/lib/security/actor";
import { getUserPreferredCurrency } from "@/modules/auth/service";
import { getLatestEntryForUser } from "@/modules/expenses/service";
import { convertMoney } from "@/modules/currencies/money";
import { todayIso } from "@/modules/currencies/provider";
import { lookupRate } from "@/modules/currencies/rates";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("userSettings");
  return { title: t("money") };
}

/**
 * The currency totals are shown in, and how dates and amounts are written.
 *
 * Three choices about notation rather than about money: none of them touches a
 * stored amount or a frozen exchange rate, and every one changes only what the
 * reader sees. Which is exactly why the screen leads with a preview — the only
 * honest way to describe a notation is to write something in it, and the only
 * amount worth writing is one the reader already recognises.
 *
 * The server's whole job here is that one line: the reader's last entry, and
 * what it comes to in the currency their home screen totals in. Everything
 * else — which chip is lit, how the amount reads under it — is decided in the
 * browser, because it has to change on the tap rather than a round trip later.
 *
 * How somebody wants to be paid back used to sit at the bottom of this screen.
 * It has its own now, at `/settings/payouts`: it is about money actually
 * moving, which is a different question from how a number is punctuated.
 */
export default async function MoneySettingsPage() {
  const user = await getCurrentUser();
  if (!user) return null;

  const t = await getTranslations("userSettings");
  const [preferred, entry] = await Promise.all([
    getUserPreferredCurrency(user.userId),
    getLatestEntryForUser(user.userId),
  ]);

  // An account that has never chosen one is shown the fallback the dashboard
  // already totals in, rather than an empty chip.
  const currency = preferred ?? "EUR";

  return (
    <SettingsScreen
      title={t("money")}
      back={{ href: "/settings", label: t("backToSettings") }}
    >
      <MoneyFormats
        entry={entry}
        converted={await convertedTotal(entry, currency)}
        currency={currency}
      />

      <p className="shrink-0 px-1.5 text-xs leading-relaxed text-pretty text-muted-foreground">
        {t("formatsNote")}
      </p>
    </SettingsScreen>
  );
}

/**
 * The entry again, in the currency the home screen totals in.
 *
 * Same currency, nothing to convert — the line still renders, because "this is
 * what it adds to your totals" is worth saying even when the answer is the
 * same number, and a row that vanishes for Swiss accounts and appears for
 * everyone else is a worse explanation than one that always says it.
 *
 * No rate, no line. The alternative is showing a figure whose provenance we
 * cannot state, on a screen whose entire subject is how numbers are written.
 */
async function convertedTotal(
  entry: PreviewEntry | null,
  currency: string,
): Promise<PreviewEntry | null> {
  if (!entry) return null;
  if (entry.currency === currency) return entry;

  const quote = await lookupRate({
    from: entry.currency,
    to: currency,
    on: todayIso(),
  }).catch(() => null);
  if (!quote) return null;

  const converted = convertMoney(
    { amount: BigInt(entry.amount), currency: entry.currency },
    currency,
    quote.rate,
  );
  return {
    ...entry,
    amount: converted.amount.toString(),
    currency: converted.currency,
  };
}
