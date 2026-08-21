import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  AlignJustify,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Equal,
  Paperclip,
  Pencil,
  PieChart,
  Percent,
  RefreshCw,
} from "lucide-react";
import { getDateFormatter, getNumberLocale } from "@/i18n/preferences";
import { Button } from "@/components/ui/button";
import { Amount } from "@/components/money/amount";
import {
  ACTION,
  ACTION_NEUTRAL,
  ActionBar,
  BigAmount,
  CountChip,
  DetailCard,
  FileRow,
  MetaChip,
  MetaField,
  MetaStrip,
  PartyRow,
  PartyTable,
  PartyTableRow,
  Section,
  TypeChip,
  type PersonTone,
} from "@/components/entries/detail-blocks";
import { fileKindOf, fileSizeOf } from "@/components/entries/file-meta";
import { DeleteEntryButton } from "@/components/entries/delete-entry-button";
import { requireGroupAccess } from "@/lib/actions";
import { getExpense } from "@/modules/expenses/service";
import { getRecurrenceCadence } from "@/modules/recurring/service";
import { listAttachmentsForExpense } from "@/modules/attachments/service";
import {
  isExpenseCategory,
  isValidSubcategory,
} from "@/modules/categorization";
import {
  CATEGORY_GLYPHS,
  FALLBACK_GLYPH,
  hasGlyph,
} from "@/components/expenses/category-icon";
import { signOf } from "@/modules/expenses/direction";
import { POP, PUSH } from "@/components/motion/transitions";

/**
 * One entry, read back.
 *
 * Spending and income are the same row in the same table with one sign
 * between them, so they are also the same screen: what changes is the word on
 * the chip, the colour of the figure, and whether the people below it were
 * *split between* or *credited to*. Stating the kind rather than leaving it to
 * be inferred from a colour is the point of the chip — a green figure is not a
 * sentence.
 *
 * Every figure on the screen is in the entry's own currency, which is what was
 * actually paid. When the group converts, the strip under the amount says what
 * that came to in the group's currency and at which frozen rate.
 */

/** Split method → the catalogue key and the glyph that stands for it. */
const SPLIT_METHODS = {
  equal: { key: "splitEqual", icon: Equal },
  exact: { key: "splitExact", icon: AlignJustify },
  percentage: { key: "splitPercentage", icon: Percent },
  shares: { key: "splitShares", icon: PieChart },
} as const;

export default async function TransactionDetailPage({
  params,
}: PageProps<"/groups/[groupId]/expenses/[expenseId]">) {
  const { groupId, expenseId } = await params;
  const access = await requireGroupAccess(groupId);

  const expense = await getExpense(access.groupId, expenseId);
  if (!expense) {
    notFound();
  }

  const [
    attachments,
    cadence,
    t,
    tCommon,
    tCategories,
    tSubcategories,
    tMoney,
    dates,
    locale,
  ] = await Promise.all([
    listAttachmentsForExpense(access.groupId, expenseId),
    expense.recurringExpenseId === null
      ? null
      : getRecurrenceCadence(access.groupId, expense.recurringExpenseId),
    getTranslations("transactionDetail"),
    getTranslations("common"),
    getTranslations("expenses.categories"),
    getTranslations("expenses.subcategories"),
    getTranslations("money"),
    getDateFormatter(),
    getNumberLocale(),
  ]);

  const revenue = expense.direction === "in";
  const tone = revenue ? "revenue" : "expense";
  const currency = expense.currency;
  const self = access.participantId;
  const sign = signOf(expense.direction);

  // Canonical categories are translated; anything else came from an import
  // and is shown exactly as it was imported.
  //
  // The detail screen is where the subcategory earns its place: one entry, all
  // the room, and the reader came here for exactly this level of detail. The
  // list deliberately shows the category alone — see `transactions.tsx`.
  const categoryLabel = !expense.category
    ? null
    : isExpenseCategory(expense.category)
      ? isValidSubcategory(expense.category, expense.subcategory) &&
        expense.subcategory
        ? `${tCategories(expense.category)} · ${tSubcategories(
            `${expense.category}.${expense.subcategory}` as Parameters<
              typeof tSubcategories
            >[0],
          )}`
        : tCategories(expense.category)
      : expense.category;
  const CategoryGlyph = hasGlyph(expense.category)
    ? CATEGORY_GLYPHS[expense.category]
    : FALLBACK_GLYPH;

  const split = SPLIT_METHODS[expense.splitMethod];

  /**
   * What this entry did to one person's balance — not what the group's
   * balances are now, which is the same three figures on every screen in the
   * group and says nothing about the entry being read.
   *
   * Paid minus owed, signed by direction: income is spending run backwards, so
   * whoever received the money is the one who now owes the others.
   */
  const impactOf = (participantId: string): bigint => {
    const paid = expense.payers
      .filter((payer) => payer.participantId === participantId)
      .reduce((sum, payer) => sum + payer.amount, 0n);
    const owed = expense.shares
      .filter((share) => share.participantId === participantId)
      .reduce((sum, share) => sum + share.amount, 0n);
    return sign * (paid - owed);
  };

  // You first: the row somebody came to this screen to read should not have to
  // be found among the others.
  const shares = [...expense.shares].sort((left, right) => {
    if (left.participantId === right.participantId) return 0;
    if (left.participantId === self) return -1;
    if (right.participantId === self) return 1;
    return 0;
  });

  const moved = shares.some((share) => impactOf(share.participantId) !== 0n);

  const toneOf = (participantId: string): PersonTone =>
    participantId === self ? "self" : "other";

  const converted =
    expense.convertedAmount !== null && expense.convertedCurrency !== null;

  return (
    // Clears the docked action bar, which the screen's own bottom inset only
    // knows to clear the navigation under it.
    <div className="flex flex-col gap-3 pb-[4.5rem]">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${groupId}/expenses`} transitionTypes={POP}>
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
      </div>

      <DetailCard className="flex flex-col gap-3.5 p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <TypeChip
            tone={tone}
            icon={revenue ? ArrowUp : ArrowDown}
            label={t(`types.${tone}`)}
          />
          {categoryLabel && (
            <MetaChip icon={CategoryGlyph}>{categoryLabel}</MetaChip>
          )}
          {attachments.length > 0 && (
            <CountChip
              icon={Paperclip}
              label={t("attachments", { count: attachments.length })}
            >
              {attachments.length}
            </CountChip>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <BigAmount
            minorUnits={expense.amount.toString()}
            currency={currency}
            tone={tone}
            locale={locale}
          />
          <h1 className="text-[17px] font-medium">{expense.description}</h1>
        </div>

        <MetaStrip>
          <MetaField label={t("date")}>
            {dates.plain(expense.expenseDate)}
          </MetaField>
          <MetaField label={t("repeats")}>
            {cadence ? (
              <>
                <RefreshCw
                  aria-hidden="true"
                  className="size-3 shrink-0 text-muted-foreground"
                />
                {t(REPEAT_KEYS[cadence.frequency], {
                  count: cadence.interval,
                })}
              </>
            ) : (
              t("oneOff")
            )}
          </MetaField>
          {converted && (
            <MetaField
              label={t("inGroupCurrency", {
                currency: expense.convertedCurrency as string,
              })}
              className="col-span-2"
            >
              <Amount
                minorUnits={(expense.convertedAmount as bigint).toString()}
                currency={expense.convertedCurrency as string}
              />
              {expense.exchangeRate && (
                <span className="truncate text-muted-foreground">
                  {t("atRate", {
                    rate: formatRate(expense.exchangeRate, locale),
                  })}
                </span>
              )}
            </MetaField>
          )}
        </MetaStrip>
      </DetailCard>

      <Section label={t(revenue ? "receivedBy" : "paidBy")}>
        <DetailCard className="divide-y divide-border">
          {expense.payers.map((payer) => (
            <PartyRow
              key={payer.participantId}
              name={payer.displayName}
              // Amber marks whoever put the money in, here as on the split
              // sheet — the one role coral cannot carry, because the payer is
              // usually in the split as well.
              tone="payer"
              minorUnits={payer.amount.toString()}
              currency={currency}
            />
          ))}
        </DetailCard>
      </Section>

      <Section
        label={t(revenue ? "creditedTo" : "splitBetween")}
        chip={
          <MetaChip icon={split.icon} small>
            {t(split.key)}
          </MetaChip>
        }
      >
        <DetailCard>
          <PartyTable
            personLabel={t("person")}
            figureLabel={t(revenue ? "credited" : "share")}
            balanceLabel={moved ? t("balance") : null}
          >
            {shares.map((share) => {
              const impact = impactOf(share.participantId);
              return (
                <PartyTableRow
                  key={share.participantId}
                  name={share.displayName}
                  tone={toneOf(share.participantId)}
                  minorUnits={share.amount.toString()}
                  currency={currency}
                  balance={
                    moved
                      ? {
                          minorUnits: impact.toString(),
                          label: tMoney(
                            impact > 0n
                              ? "getsBack"
                              : impact < 0n
                                ? "owes"
                                : "settledUp",
                          ),
                        }
                      : null
                  }
                />
              );
            })}
          </PartyTable>
        </DetailCard>
      </Section>

      {expense.notes && (
        <Section label={t("notes")}>
          <DetailCard>
            <p className="px-3.5 py-3 text-[14px] whitespace-pre-wrap">
              {expense.notes}
            </p>
          </DetailCard>
        </Section>
      )}

      {attachments.length > 0 && (
        <Section label={t("files")}>
          <DetailCard className="divide-y divide-border">
            {attachments.map((attachment) => {
              const size = fileSizeOf(attachment.byteSize);
              return (
                <FileRow
                  key={attachment.id}
                  href={`/api/groups/${groupId}/attachments/${attachment.id}`}
                  name={attachment.fileName}
                  meta={t(
                    size.unit === "kilobytes"
                      ? "fileKilobytes"
                      : "fileMegabytes",
                    {
                      kind: t(`fileKind.${fileKindOf(attachment.contentType)}`),
                      size: size.size,
                    },
                  )}
                />
              );
            })}
          </DetailCard>
        </Section>
      )}

      <ActionBar>
        <Link
          href={`/groups/${groupId}/expenses/${expenseId}/edit`}
          transitionTypes={PUSH}
          className={`${ACTION} ${ACTION_NEUTRAL}`}
        >
          <Pencil aria-hidden="true" className="size-4" />
          {t("edit")}
        </Link>
        <DeleteEntryButton
          groupId={groupId}
          kind="expense"
          id={expenseId}
          description={expense.description}
        />
      </ActionBar>
    </div>
  );
}

/** One message per frequency, each covering "Monthly" and "Every 2 months". */
const REPEAT_KEYS = {
  weekly: "repeatWeekly",
  monthly: "repeatMonthly",
  yearly: "repeatYearly",
} as const;

/**
 * The frozen rate, in the reader's notation.
 *
 * Stored at twelve decimal places so a conversion never drifts; nobody reads
 * more than four of them, and the trailing zeros of a rate of exactly 1.1 are
 * noise on a line that is already parenthetical.
 */
function formatRate(rate: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    maximumFractionDigits: 4,
  }).format(rate as unknown as number);
}
