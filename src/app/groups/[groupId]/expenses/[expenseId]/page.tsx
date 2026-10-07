import { cache } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import {
  AlignJustify,
  ArrowDown,
  ArrowUp,
  Equal,
  Paperclip,
  Pencil,
  PieChart,
  Percent,
  RefreshCw,
} from "lucide-react";
import { getDateFormatter, getNumberLocale } from "@/i18n/preferences";
import { Amount } from "@/components/money/amount";
import { PageHeader } from "@/components/ui/page-header";
import {
  ACTION,
  ACTION_NEUTRAL,
  ActionBar,
  BigAmount,
  CountChip,
  DetailCard,
  FileRow,
  HeaderActions,
  MetaChip,
  MetaField,
  MetaLine,
  MetaStrip,
  PartyRow,
  Section,
  TypeChip,
} from "@/components/entries/detail-blocks";
import {
  SplitCard,
  SplitTable,
  YourStake,
} from "@/components/entries/stake-blocks";
import { Button } from "@/components/ui/button";
import { fileKindOf, fileSizeOf } from "@/components/entries/file-meta";
import { DeleteEntryButton } from "@/components/entries/delete-entry-button";
import { requireGroupAccess } from "@/lib/actions";
import { getExpense } from "@/modules/expenses/service";
import { getRecurrenceCadence } from "@/modules/recurring/service";
import type { RecurrenceFrequency } from "@/modules/recurring/schedule";
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
import { listQuery, withQuery } from "@/components/expenses/list-query";
import { withFragment } from "@/components/entries/drawer-fragment";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";
import { titleAccess } from "../../title-access";

/**
 * One entry, read back.
 *
 * Spending and income are the same row in the same table with one sign
 * between them, so they are also the same screen: what changes is the word on
 * the chip, the sentences that say what it did to people, and whether the
 * people below it were *split between* or *credited to*. Stating the kind
 * rather than leaving it to be inferred from a colour is the point of the
 * chip — a green figure is not a sentence.
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

/**
 * The entry, read once for the title and the screen together.
 *
 * `cache` is per request, so the second read is the first one's answer rather
 * than a second round of queries for the same row.
 */
const findExpense = cache(getExpense);

/** Named by the entry, as the screen's own heading is. */
export async function generateMetadata({
  params,
}: PageProps<"/groups/[groupId]/expenses/[expenseId]">): Promise<Metadata> {
  const { groupId, expenseId } = await params;
  const access = await titleAccess(groupId);
  const expense = access && (await findExpense(access.groupId, expenseId));
  return expense ? { title: expense.description } : {};
}

export default async function TransactionDetailPage({
  params,
  searchParams,
}: PageProps<"/groups/[groupId]/expenses/[expenseId]">) {
  const { groupId, expenseId } = await params;
  const access = await requireGroupAccess(groupId);

  /*
   * The state of the list this was opened from, riding along.
   *
   * Back is a link rather than `router.back()` because this screen is also
   * something you can be sent — a link in a chat, a bookmark, a refresh — and
   * a reader who arrived that way has nothing behind them to pop to. A link
   * always leads to the list; carrying the filters is what makes it lead back
   * to the *same* list for the reader who came from one.
   */
  const listFilters = listQuery(await searchParams);

  const expense = await findExpense(access.groupId, expenseId);
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
    getDateFormatter(),
    getNumberLocale(),
  ]);

  const revenue = expense.direction === "in";
  const tone = revenue ? "revenue" : "expense";
  const currency = expense.currency;
  const self = access.participantId;

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

  const converted =
    expense.convertedAmount !== null && expense.convertedCurrency !== null;

  // The filters go into the drawer with it, so that a save which turns this
  // entry into a repayment — and so lands the reader on another detail screen
  // — still leaves them a way back to the list they were reading. In the
  // fragment, because the drawer is an intercepted route and a query on one of
  // those wedges it: see `components/entries/drawer-fragment.ts`.
  const editHref = withFragment(
    `/groups/${groupId}/expenses/${expenseId}/edit`,
    listFilters,
  );
  const backTo = withQuery(`/groups/${groupId}/expenses`, listFilters);

  /*
   * Who put the money in, for the desk header's line of facts. A payer down
   * for nothing is a leftover of a multi-payer edit — see `stakeOf` — and the
   * reader is "you" here as everywhere they are a party.
   */
  const payers = expense.payers.filter((payer) => payer.amount > 0n);
  const payerLine =
    payers.length === 1 && payers[0].participantId === self
      ? t(revenue ? "meta.receivedYou" : "meta.paidYou")
      : payers.length > 0
        ? t(revenue ? "meta.received" : "meta.paid", {
            count: payers.length,
            name: payers[0].displayName,
          })
        : null;

  const splitLabel = t(revenue ? "creditedTo" : "splitBetween");
  const hasAside = Boolean(expense.notes) || attachments.length > 0;

  return (
    // Clears the docked action bar, which the screen's own bottom inset only
    // knows to clear the navigation under it. From `lg` the actions are in
    // the header and there is no bar to clear.
    <div className="flex flex-col gap-3 pb-[4.5rem] lg:gap-4 lg:pb-0">
      {/* The entry names the screen, so the card below it does not say the
          description again — it opens on the figure, which is what the reader
          came back for. */}
      <PageHeader
        title={expense.description}
        back={{
          href: backTo,
          label: tCommon("backToTransactions"),
        }}
        // Board 08: on a desk the header states the entry's facts in one line
        // and carries its two actions, which a phone docks at its foot.
        meta={
          <MetaLine
            items={[
              dates.plain(expense.expenseDate, "long"),
              ...(payerLine ? [payerLine] : []),
              ...(categoryLabel ? [categoryLabel] : []),
            ]}
          />
        }
        trailing={
          <HeaderActions>
            <Button asChild variant="outline" size="lg">
              <Link href={editHref} transitionTypes={PUSH}>
                <Pencil aria-hidden="true" />
                {t("edit")}
              </Link>
            </Button>
            <DeleteEntryButton
              groupId={groupId}
              kind="expense"
              id={expenseId}
              description={expense.description}
              backTo={backTo}
              placement="header"
            />
          </HeaderActions>
        }
      />

      {/*
       * From `xl` the entry and its split on the left, the notes and files in
       * a column beside them (board 08). Between `lg` and `xl` the window
       * beside the sidebar is not wide enough for both, so the second column
       * wraps under the first — the order a phone reads them in, which is
       * also the order they are in here. An entry with neither notes nor
       * files has no second column, and keeps the one readable column every
       * other pushed screen has.
       */}
      <div
        data-layout={hasAside ? "wide" : undefined}
        className={cn(
          "flex flex-col gap-3 lg:gap-4",
          hasAside &&
            "xl:grid xl:grid-cols-[minmax(0,1fr)_21.25rem] xl:items-start xl:gap-7",
        )}
      >
        <div className="flex min-w-0 flex-col gap-3 lg:gap-4">
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

            <BigAmount
              minorUnits={expense.amount.toString()}
              currency={currency}
              locale={locale}
              caption={
                <YourStake
                  entry={expense}
                  participantId={self}
                  currency={currency}
                  locale={locale}
                />
              }
            />

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

          {/* Below `lg` only: from there the split table has a Paid column, and
          a second list of the same payers above it would say it twice. */}
          <div className="lg:hidden">
            <Section label={t(revenue ? "receivedBy" : "paidBy")}>
              <DetailCard className="divide-y divide-border">
                {expense.payers.map((payer) => (
                  <PartyRow
                    key={payer.participantId}
                    name={payer.displayName}
                    // Amber marks whoever put the money in, here as on the split
                    // sheet — the one role coral cannot carry, because the payer
                    // is usually in the split as well.
                    tone="payer"
                    minorUnits={payer.amount.toString()}
                    currency={currency}
                  />
                ))}
              </DetailCard>
            </Section>
          </div>

          <Section
            label={splitLabel}
            chip={
              <MetaChip icon={split.icon} small>
                {t(split.key)}
              </MetaChip>
            }
          >
            {/* A list on a phone, a table on a desk: the same people and the same
            words, drawn for the width there is. Exactly one is ever shown. */}
            <div className="lg:hidden">
              <SplitCard
                entry={expense}
                participantId={self}
                currency={currency}
                locale={locale}
              />
            </div>
            <div className="hidden lg:block">
              <SplitTable
                entry={expense}
                participantId={self}
                currency={currency}
                locale={locale}
                label={splitLabel}
              />
            </div>
          </Section>
        </div>

        <div className="flex min-w-0 flex-col gap-3 empty:hidden lg:gap-4">
          {expense.notes && (
            <Section label={t("notes")}>
              <DetailCard>
                <p className="px-3.5 py-3 text-sm whitespace-pre-wrap">
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
                          kind: t(
                            `fileKind.${fileKindOf(attachment.contentType)}`,
                          ),
                          size: size.size,
                        },
                      )}
                    />
                  );
                })}
              </DetailCard>
            </Section>
          )}
        </div>
      </div>

      <ActionBar>
        <Link
          href={editHref}
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
          backTo={backTo}
        />
      </ActionBar>
    </div>
  );
}

/** One message per frequency, each covering "Monthly" and "Every 2 months". */
const REPEAT_KEYS = {
  daily: "repeatDaily",
  weekly: "repeatWeekly",
  monthly: "repeatMonthly",
  yearly: "repeatYearly",
} as const satisfies Record<RecurrenceFrequency, string>;

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
