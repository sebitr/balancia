"use client";

import Link from "next/link";
import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronRight,
  Plus,
} from "lucide-react";
import { Amount } from "@/components/money/amount";
import { RemindButton } from "@/components/reminders/remind-button";
import { SettleUpDialog } from "@/components/settlements/settle-up-dialog";
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
    readonly settlementsPaid: string;
    readonly settlementsReceived: string;
    readonly otherAdjustments: string;
  };
}

interface ParticipantOption {
  readonly id: string;
  readonly displayName: string;
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
  participants,
  currencyMode,
  baseCurrency,
  canArchive,
}: {
  positions: readonly PositionHeroView[];
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
  participants: readonly ParticipantOption[];
  currencyMode: "separate" | "converted";
  baseCurrency: string | null;
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

  const defaultCurrency = baseCurrency ?? positions[0]?.currency ?? "EUR";
  const remindLabel =
    recipients.length === 1
      ? t("remindPerson", { name: recipients[0].name })
      : t("remindAll");

  const settlement = (primary: boolean) => (
    <SettleUpDialog
      groupId={groupId}
      participants={participants}
      currencyMode={currencyMode}
      baseCurrency={baseCurrency}
      defaultCurrency={defaultCurrency}
      trigger={
        <Button
          variant={primary ? "default" : "outline"}
          size="lg"
          className="h-[46px] flex-1 rounded-[13px] text-sm font-semibold"
        >
          <Check aria-hidden="true" className="size-4" />
          {t("settleUp")}
        </Button>
      }
    />
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
          <SheetDescription className="mt-1 text-xs">
            {t("positionSheetDescription")}
          </SheetDescription>

          <div className="mt-5 flex flex-col gap-5">
            {positions.map((position) => (
              <PositionBreakdown key={position.currency} position={position} />
            ))}
          </div>

          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            {t("positionRoutingNote")}
          </p>
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

function PositionBreakdown({ position }: { position: PositionHeroView }) {
  const t = useTranslations("group");
  const rows = [
    { key: "positionYouPaid", value: position.breakdown.paid, sign: 1n },
    { key: "positionYourShare", value: position.breakdown.share, sign: -1n },
    {
      key: "positionSettlementsPaid",
      value: position.breakdown.settlementsPaid,
      sign: 1n,
    },
    {
      key: "positionSettlementsReceived",
      value: position.breakdown.settlementsReceived,
      sign: -1n,
    },
    {
      key: "positionOtherAdjustments",
      value: position.breakdown.otherAdjustments,
      sign: 1n,
    },
  ].filter(
    (row) => row.key !== "positionOtherAdjustments" || row.value !== "0",
  );

  return (
    <section className="rounded-2xl bg-card ring-1 ring-border">
      <h3 className="border-b px-4 py-3 text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {position.currency}
      </h3>
      <dl className="px-4 py-1">
        {rows.map((row) => {
          const signed = BigInt(row.value) * row.sign;
          return (
            <div
              key={row.key}
              className="flex min-h-11 items-center justify-between gap-4 border-t first:border-t-0"
            >
              <dt className="text-sm text-muted-foreground">
                {t(row.key as "positionYouPaid")}
              </dt>
              <dd className="text-sm font-medium tabular-nums">
                <Amount
                  minorUnits={signed.toString()}
                  currency={position.currency}
                  display="code"
                  signDisplay="exceptZero"
                />
              </dd>
            </div>
          );
        })}
        <div className="flex min-h-12 items-center justify-between gap-4 border-t">
          <dt className="font-semibold">{t("positionResult")}</dt>
          <dd
            className={cn(
              "font-semibold tabular-nums",
              BigInt(position.minorUnits) > 0n && "text-positive",
              BigInt(position.minorUnits) < 0n && "text-negative",
              BigInt(position.minorUnits) === 0n && "text-neutral-balance",
            )}
          >
            <Amount
              minorUnits={position.minorUnits}
              currency={position.currency}
              display="code"
              signDisplay="exceptZero"
            />
          </dd>
        </div>
      </dl>
    </section>
  );
}
