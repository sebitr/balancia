import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  Banknote,
  CreditCard,
  Landmark,
  Pencil,
} from "lucide-react";
import { getDateFormatter, getNumberLocale } from "@/i18n/preferences";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/money/amount";
import {
  ACTION,
  ACTION_NEUTRAL,
  ActionBar,
  BigAmount,
  ChangeRow,
  DetailCard,
  MetaChip,
  MetaField,
  MetaStrip,
  PersonAvatar,
  Section,
  TypeChip,
  type PersonTone,
} from "@/components/entries/detail-blocks";
import { DeleteEntryButton } from "@/components/entries/delete-entry-button";
import { requireGroupAccess } from "@/lib/actions";
import { getSettlement } from "@/modules/settlements/service";
import { findPaymentMethod } from "@/modules/settlements/payment-methods";
import { loadGroupBalances } from "@/modules/balances/service";
import { moneyForGroup } from "@/modules/currencies/display";
import { formatMoney, money } from "@/modules/currencies/money";
import { listQuery, withQuery } from "@/components/expenses/list-query";
import { POP, PUSH } from "@/components/motion/transitions";

/**
 * One repayment, read back.
 *
 * A repayment used to have no screen of its own: the row in the transactions
 * list said who paid whom and how much, and there was nothing else to say. The
 * thing that was missing is the only thing anybody actually wants from a
 * repayment — whether it finished the job. So the card under the amount is not
 * a split; it is the two balances the payment moved, before and after.
 *
 * Both figures are the group's real balances, in whichever currency this
 * repayment is settled in, and "before" is that balance with this repayment
 * taken back out. Nothing here is a snapshot of a past moment: the balance
 * engine has no order, and inventing one would be a different number wearing
 * the same label.
 */

/** How the money moved, drawn by kind rather than by brand. */
const METHOD_GLYPHS = {
  cash: Banknote,
  bank: Landmark,
  brand: CreditCard,
} as const;

export default async function SettlementDetailPage({
  params,
  searchParams,
}: PageProps<"/groups/[groupId]/settlements/[settlementId]">) {
  const { groupId, settlementId } = await params;
  const access = await requireGroupAccess(groupId);

  /* The state of the list this was opened from — see the expense detail, which
     carries it for the same reason and in the same three names. */
  const listFilters = listQuery(await searchParams);

  const settlement = await getSettlement(access.groupId, settlementId);
  if (!settlement) {
    notFound();
  }

  const [balances, t, tList, tMethods, tCommon, dates, locale] =
    await Promise.all([
      loadGroupBalances(access),
      getTranslations("transactionDetail"),
      // The same sentence the transactions list titles a repayment with. One
      // copy, so the list and the screen it opens cannot word it differently.
      getTranslations("expensesList"),
      getTranslations("paymentMethods"),
      getTranslations("common"),
      getDateFormatter(),
      getNumberLocale(),
    ]);

  const self = access.participantId;

  /*
   * Balances are kept per currency, and a repayment belongs to exactly one of
   * them: its own in a group that keeps currencies apart, the base currency in
   * one that converts. That is the same choice `moneyForGroup` makes, so the
   * two can never disagree about which ledger this payment landed in.
   */
  const ledger = moneyForGroup(settlement, {
    mode: access.group.currencyMode,
    baseCurrency: access.group.baseCurrency,
  });
  const standing = new Map(
    (
      balances.currencies.find((entry) => entry.currency === ledger.currency)
        ?.balances ?? []
    ).map((balance) => [balance.participantId, balance.amount]),
  );

  /** Paying moves your balance up; receiving moves theirs down. */
  const changed = [
    {
      participantId: settlement.fromParticipantId,
      name: settlement.fromName,
      delta: ledger.amount,
    },
    {
      participantId: settlement.toParticipantId,
      name: settlement.toName,
      delta: -ledger.amount,
    },
  ];

  const description =
    settlement.notes?.trim() ||
    tList("settlementTitle", {
      from: settlement.fromName,
      to: settlement.toName,
    });

  const method = settlement.paymentMethod
    ? findPaymentMethod(settlement.paymentMethod)
    : undefined;
  const MethodGlyph = method ? METHOD_GLYPHS[method.kind] : undefined;

  const converted =
    settlement.convertedAmount !== null &&
    settlement.convertedCurrency !== null;

  const toneOf = (participantId: string): PersonTone =>
    participantId === self ? "self" : "other";

  return (
    <div className="flex flex-col gap-3 pb-[4.5rem]">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link
            href={withQuery(`/groups/${groupId}/expenses`, listFilters)}
            transitionTypes={POP}
          >
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
      </div>

      <DetailCard className="flex flex-col gap-3.5 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeChip
            tone="settlement"
            icon={ArrowLeftRight}
            label={t("types.settlement")}
          />
          {settlement.paymentMethod && (
            <MetaChip icon={MethodGlyph}>
              {/* An unrecognised method came in through the API or an import
                  and is shown exactly as it was recorded. */}
              {method ? tMethods(method.id) : settlement.paymentMethod}
            </MetaChip>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <BigAmount
            minorUnits={settlement.amount.toString()}
            currency={settlement.currency}
            tone="settlement"
            locale={locale}
          />
          <h1 className="text-base font-medium">{description}</h1>
        </div>

        <MetaStrip className="flex flex-wrap items-center gap-x-2.5 gap-y-3">
          <MetaField label={t("date")}>
            {dates.plain(settlement.settledOn)}
          </MetaField>
          <MetaField
            label={t("fromTo")}
            className="ml-1.5 flex-1 border-l border-border pl-4"
          >
            <PersonAvatar
              name={settlement.fromName}
              tone={toneOf(settlement.fromParticipantId)}
              small
            />
            <span className="truncate">{settlement.fromName}</span>
            <ArrowRight
              aria-hidden="true"
              className="size-3.5 shrink-0 text-muted-foreground"
            />
            <PersonAvatar
              name={settlement.toName}
              tone={toneOf(settlement.toParticipantId)}
              small
            />
            <span className="truncate">{settlement.toName}</span>
          </MetaField>
          {converted && (
            <MetaField
              label={t("inGroupCurrency", {
                currency: settlement.convertedCurrency as string,
              })}
              className="ml-1.5 w-full border-l border-border pl-4"
            >
              <Amount
                minorUnits={(settlement.convertedAmount as bigint).toString()}
                currency={settlement.convertedCurrency as string}
              />
              {settlement.exchangeRate && (
                <span className="truncate text-muted-foreground">
                  {t("atRate", {
                    rate: new Intl.NumberFormat(locale, {
                      maximumFractionDigits: 4,
                    }).format(settlement.exchangeRate as unknown as number),
                  })}
                </span>
              )}
            </MetaField>
          )}
        </MetaStrip>
      </DetailCard>

      <Section label={t("whatChanged")}>
        <DetailCard className="divide-y divide-border">
          {changed.map((person) => {
            const now = standing.get(person.participantId) ?? 0n;
            const before = now - person.delta;
            const magnitude = before < 0n ? -before : before;
            return (
              <ChangeRow
                key={person.participantId}
                name={person.name}
                tone={toneOf(person.participantId)}
                before={
                  before === 0n
                    ? t("settledBefore")
                    : t(before > 0n ? "backBefore" : "owedBefore", {
                        amount: formatAmount(
                          magnitude,
                          ledger.currency,
                          locale,
                        ),
                      })
                }
                minorUnits={now.toString()}
                currency={ledger.currency}
                settledLabel={t("settledUp")}
                standingLabel={t(now > 0n ? "stillGetsBack" : "stillOwes")}
              />
            );
          })}
        </DetailCard>
      </Section>

      {/* No files section: an attachment belongs to an expense — the
          `attachments` table has no settlement to hang one on. */}

      <ActionBar>
        <Link
          href={withQuery(
            `/groups/${groupId}/settlements/${settlementId}/edit`,
            listFilters,
          )}
          transitionTypes={PUSH}
          className={`${ACTION} ${ACTION_NEUTRAL}`}
        >
          <Pencil aria-hidden="true" className="size-4" />
          {t("edit")}
        </Link>
        <DeleteEntryButton
          groupId={groupId}
          kind="settlement"
          id={settlementId}
          description={description}
          backTo={withQuery(`/groups/${groupId}/expenses`, listFilters)}
        />
      </ActionBar>
    </div>
  );
}

/**
 * A balance inside a sentence.
 *
 * `Amount` is a client component and cannot be interpolated into an ICU
 * message, so this is the one place money is formatted on the server — with
 * the same locale that component would have read from context.
 */
function formatAmount(
  minorUnits: bigint,
  currency: string,
  locale: string,
): string {
  return formatMoney(money(minorUnits, currency), { locale });
}
