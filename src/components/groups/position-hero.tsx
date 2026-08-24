"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Amount } from "@/components/money/amount";
import { RemindButton } from "@/components/reminders/remind-button";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  openOnContent,
} from "@/components/ui/sheet";
import { useNumberLocale } from "@/i18n/format-context";
import type { RemindRecipient } from "@/modules/reminders/types";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

export interface PositionHeroView {
  readonly currency: string;
  readonly minorUnits: string;
  readonly counterparties: readonly {
    readonly participantId: string;
    readonly name: string;
    readonly minorUnits: string;
  }[];
  readonly breakdown: {
    readonly paid: string;
    readonly share: string;
    readonly revenueReceived: string;
    readonly revenueCredited: string;
    readonly settlementsPaid: string;
    readonly settlementsReceived: string;
    readonly otherAdjustments: string;
  };
}

/**
 * The first answer on the screen: a large position, its human meaning and the
 * next useful action. The existing reminder and settlement flows stay intact;
 * this card only gives them the hierarchy the mobile overview calls for.
 */
export function PositionHero({
  positions,
  groupId,
  groupName,
  senderName,
  recipients,
  canArchive,
}: {
  positions: readonly PositionHeroView[];
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
  canArchive: boolean;
}) {
  const t = useTranslations("group");
  const format = useFormatter();
  const [positionOpen, setPositionOpen] = useState(false);
  const open = positions.filter(
    (position) => BigInt(position.minorUnits) !== 0n,
  );
  const single = open.length === 1 ? open[0] : null;
  const settled = open.length === 0;
  const mixed =
    open.some((position) => BigInt(position.minorUnits) > 0n) &&
    open.some((position) => BigInt(position.minorUnits) < 0n);
  const positive = single && BigInt(single.minorUnits) > 0n;

  const subline = single
    ? positive
      ? single.counterparties.length === 1
        ? t("personOwesYou", { name: single.counterparties[0].name })
        : t("peopleOweYou", { count: single.counterparties.length })
      : single.counterparties.length === 1
        ? t("youOwePerson", { name: single.counterparties[0].name })
        : t("youOwePeople", {
            names: format.list(
              single.counterparties.map((party) => party.name),
              { type: "conjunction" },
            ),
          })
    : mixed
      ? t("overallMixed")
      : t("positionAcrossCurrencies");

  const remindLabel =
    recipients.length === 1
      ? t("remindPerson", { name: recipients[0].name })
      : t("remindAll");

  /**
   * Settling is a screen, not a form.
   *
   * This used to open the record-a-payment dialog directly, which asked the
   * reader to fill in who, whom and how much — the three things the group's
   * own balances already answer. It now goes to the settle-up screen, which
   * states the transfers that clear the group and puts the same dialog behind
   * each one, prefilled.
   */
  const settlement = (primary: boolean) => (
    <Button
      asChild
      variant={primary ? "default" : "outline"}
      size="lg"
      className="h-[46px] flex-1 rounded-[13px] text-sm font-semibold"
    >
      <Link href={`/groups/${groupId}/settle`} transitionTypes={PUSH}>
        <Check aria-hidden="true" className="size-4" />
        {t("settleUp")}
      </Link>
    </Button>
  );

  return (
    <>
      <section
        aria-labelledby="your-position"
        className="flex flex-col gap-3.5 rounded-[22px] bg-card p-5 ring-1 ring-border"
      >
        <h2 id="your-position" className="sr-only">
          {t("yourPosition")}
        </h2>

        {settled ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-2xs font-semibold tracking-[0.1em] text-neutral-balance uppercase">
              {t("allSettled")}
            </span>
            <p className="text-lg font-medium">{t("noOutstandingBalances")}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2.5">
            <div className="flex flex-col gap-1.5">
              {open.map((position) => {
                const incoming = BigInt(position.minorUnits) > 0n;
                return (
                  <HeroAmount
                    key={position.currency}
                    currency={position.currency}
                    minorUnits={
                      incoming
                        ? position.minorUnits
                        : (-BigInt(position.minorUnits)).toString()
                    }
                    incoming={incoming}
                  />
                );
              })}
            </div>

            <p className="flex items-center gap-2 text-sm">
              <span
                className={cn(
                  "flex size-[18px] shrink-0 items-center justify-center rounded-full",
                  single && BigInt(single.minorUnits) < 0n
                    ? "bg-negative/15 text-negative"
                    : "bg-positive/15 text-positive",
                )}
              >
                {single && BigInt(single.minorUnits) < 0n ? (
                  <ArrowUp aria-hidden="true" className="size-3" />
                ) : (
                  <ArrowDown aria-hidden="true" className="size-3" />
                )}
              </span>
              <span className="truncate">{subline}</span>
            </p>
          </div>
        )}

        <div className="flex items-center gap-2">
          {settled ? (
            <>
              <Button
                asChild
                size="lg"
                className="h-[46px] flex-1 rounded-[13px] text-sm font-semibold"
              >
                <Link href={`/groups/${groupId}/expenses/new`}>
                  <Plus aria-hidden="true" className="size-4" />
                  {t("addExpense")}
                </Link>
              </Button>
              {canArchive && (
                <Button
                  asChild
                  variant="outline"
                  size="lg"
                  className="h-[46px] flex-1 rounded-[13px] text-sm font-semibold"
                >
                  <Link
                    href={`/groups/${groupId}/settings`}
                    transitionTypes={PUSH}
                  >
                    <Archive aria-hidden="true" className="size-4" />
                    {t("archiveGroup")}
                  </Link>
                </Button>
              )}
            </>
          ) : positive && recipients.length > 0 ? (
            <>
              <RemindButton
                groupId={groupId}
                groupName={groupName}
                senderName={senderName}
                recipients={recipients}
                label={remindLabel}
                variant="default"
                className="h-[46px] flex-1 rounded-[13px] text-sm font-semibold"
              />
              {settlement(false)}
            </>
          ) : (
            <>
              {settlement(true)}
              {(mixed || recipients.length > 0) && (
                <RemindButton
                  groupId={groupId}
                  groupName={groupName}
                  senderName={senderName}
                  recipients={recipients}
                  label={remindLabel}
                  variant="outline"
                  className="h-[46px] flex-1 rounded-[13px] text-sm font-semibold"
                />
              )}
            </>
          )}
        </div>

        {!settled && (
          <button
            type="button"
            onClick={() => setPositionOpen(true)}
            className="-m-2 flex min-h-11 items-center self-start rounded-lg p-2 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            {t("howCalculated")}
            <ChevronRight aria-hidden="true" className="ml-0.5 size-3.5" />
          </button>
        )}
      </section>

      <Sheet open={positionOpen} onOpenChange={setPositionOpen}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onOpenAutoFocus={openOnContent}
          className="mx-auto max-h-[90svh] max-w-[430px] gap-0 overflow-y-auto rounded-t-[26px] bg-background px-5 pt-2.5 pb-7 data-[side=bottom]:border-t-0"
        >
          <span
            aria-hidden="true"
            className="mx-auto mb-5 block h-1 w-[38px] rounded-full bg-foreground/20"
          />
          <SheetTitle className="text-xl font-semibold tracking-[-0.02em]">
            {t("positionSheetTitle")}
          </SheetTitle>
          {/* The three subtotals explain the sheet now; this stays for the
              screen reader, which Radix requires to have something to name. */}
          <SheetDescription className="sr-only">
            {t("positionSheetDescription")}
          </SheetDescription>

          <div className="mt-[18px] flex flex-col gap-5">
            {positions.map((position) => (
              <PositionBreakdown
                key={position.currency}
                position={position}
                showCurrency={positions.length > 1}
              />
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function HeroAmount({
  currency,
  minorUnits,
  incoming,
}: {
  currency: string;
  minorUnits: string;
  incoming: boolean;
}) {
  const locale = useNumberLocale();
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "code",
  }).formatToParts(1);
  const codeFirst =
    parts.findIndex((part) => part.type === "currency") <
    parts.findIndex((part) => part.type === "integer");
  const code = (
    <span className="text-xl leading-none font-semibold tracking-[-0.01em]">
      {currency}
    </span>
  );
  const amount = (
    <Amount
      minorUnits={minorUnits}
      currency={currency}
      display="none"
      className="text-[2.5rem] leading-[0.95] font-semibold tracking-[-0.03em]"
    />
  );

  return (
    <p
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 gap-y-1",
        incoming ? "text-positive" : "text-negative",
      )}
    >
      {codeFirst ? code : amount}
      {codeFirst ? amount : code}
    </p>
  );
}

type SectionKey = "expenses" | "revenue" | "settlements";

/**
 * The ledger behind one currency's position, in three collapsible groups.
 *
 * The old sheet listed six signed rows and asked the reader to add them up.
 * Grouping them into expenses, revenue and settlements means the resulting
 * balance is the sum of three numbers, each of which is itself two — and it
 * gives income a name. It used to arrive as "Other adjustments", which in a
 * group that collects rent is the largest figure on the screen.
 *
 * Sign convention throughout: money the reader holds on the group's behalf
 * lowers their balance. Collecting income is negative; being credited part of
 * it is positive. That is an expense run backwards, which is what income is
 * everywhere else in the app.
 */
function PositionBreakdown({
  position,
  showCurrency,
}: {
  position: PositionHeroView;
  showCurrency: boolean;
}) {
  const t = useTranslations("group");
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    expenses: true,
    revenue: true,
    settlements: true,
  });

  const { currency, breakdown } = position;
  const paid = BigInt(breakdown.paid);
  const share = BigInt(breakdown.share);
  const revenueReceived = BigInt(breakdown.revenueReceived);
  const revenueCredited = BigInt(breakdown.revenueCredited);
  const settlementsPaid = BigInt(breakdown.settlementsPaid);
  const settlementsReceived = BigInt(breakdown.settlementsReceived);
  const otherAdjustments = BigInt(breakdown.otherAdjustments);
  const result = BigInt(position.minorUnits);

  const sections: readonly {
    key: SectionKey;
    title: string;
    caption: string;
    subtotal: bigint;
    rows: readonly { key: string; label: string; value: bigint }[];
  }[] = [
    {
      key: "expenses",
      title: t("positionSectionExpenses"),
      caption: t("positionExpensesCaption"),
      subtotal: paid - share,
      rows: [
        { key: "paid", label: t("positionYouPaid"), value: paid },
        { key: "share", label: t("positionYourShare"), value: -share },
      ],
    },
    {
      key: "revenue",
      title: t("positionSectionRevenue"),
      caption: t("positionRevenueCaption"),
      subtotal: revenueCredited - revenueReceived,
      rows: [
        {
          key: "received",
          label: t("positionRevenueReceived"),
          value: -revenueReceived,
        },
        {
          key: "credited",
          label: t("positionRevenueCredited"),
          value: revenueCredited,
        },
      ],
    },
    {
      key: "settlements",
      title: t("positionSectionSettlements"),
      caption: t("positionSettlementsCaption"),
      subtotal: settlementsPaid - settlementsReceived,
      rows: [
        {
          key: "settlementsPaid",
          label: t("positionSettlementsPaid"),
          value: settlementsPaid,
        },
        {
          key: "settlementsReceived",
          label: t("positionSettlementsReceived"),
          value: -settlementsReceived,
        },
      ],
    },
  ];

  // One heading level down when a currency heading sits above the sections.
  const SectionHeading = showCurrency ? "h4" : "h3";

  return (
    <div className="flex flex-col gap-2.5">
      {showCurrency && (
        <h3 className="px-1 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
          {currency}
        </h3>
      )}

      {sections.map((section) => {
        const expanded = open[section.key];
        return (
          <section
            key={section.key}
            className="rounded-2xl bg-card ring-1 ring-border"
          >
            <SectionHeading>
              <button
                type="button"
                aria-expanded={expanded}
                onClick={() =>
                  setOpen((state) => ({
                    ...state,
                    [section.key]: !state[section.key],
                  }))
                }
                className="flex min-h-11 w-full items-center justify-between gap-3 rounded-2xl px-3.5 py-2.5 text-left transition-colors hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className="flex items-center gap-[7px] text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
                  <ChevronDown
                    aria-hidden="true"
                    className={cn(
                      "size-[13px] shrink-0 transition-transform duration-150 motion-reduce:transition-none",
                      expanded ? "rotate-0" : "-rotate-90",
                    )}
                  />
                  {section.title}
                </span>
                <Amount
                  minorUnits={section.subtotal.toString()}
                  currency={currency}
                  display="code"
                  signDisplay="exceptZero"
                  className="text-xs font-semibold"
                />
              </button>
            </SectionHeading>

            {expanded && (
              <div className="border-t">
                <dl className="px-3.5">
                  {section.rows.map((row) => (
                    <div
                      key={row.key}
                      className="flex min-h-11 items-center justify-between gap-4 border-t first:border-t-0"
                    >
                      <dt className="text-sm text-muted-foreground">
                        {row.label}
                      </dt>
                      <dd className="text-sm font-medium tabular-nums">
                        <Amount
                          minorUnits={row.value.toString()}
                          currency={currency}
                          display="code"
                          signDisplay="exceptZero"
                        />
                      </dd>
                    </div>
                  ))}
                </dl>
                <p className="px-3.5 pb-3 text-xs leading-[1.45] text-pretty text-muted-foreground">
                  {section.caption}
                </p>
              </div>
            )}
          </section>
        );
      })}

      {otherAdjustments !== 0n && (
        <div className="flex min-h-11 items-center justify-between gap-4 rounded-2xl bg-card px-3.5 ring-1 ring-border">
          <span className="text-sm text-muted-foreground">
            {t("positionOtherAdjustments")}
          </span>
          <Amount
            minorUnits={otherAdjustments.toString()}
            currency={currency}
            display="code"
            signDisplay="exceptZero"
            className="text-sm font-medium"
          />
        </div>
      )}

      <div className="flex min-h-14 items-center justify-between gap-4 rounded-2xl bg-muted px-3.5 py-3 ring-1 ring-border">
        <div className="flex flex-col gap-px">
          <span className="text-sm font-semibold">{t("positionResult")}</span>
          <span className="text-2xs text-muted-foreground">
            {t("positionResultHint")}
          </span>
        </div>
        <Amount
          minorUnits={position.minorUnits}
          currency={currency}
          display="code"
          signDisplay="exceptZero"
          className={cn(
            "text-base font-semibold",
            result > 0n && "text-positive",
            result < 0n && "text-negative",
            result === 0n && "text-neutral-balance",
          )}
        />
      </div>
    </div>
  );
}
