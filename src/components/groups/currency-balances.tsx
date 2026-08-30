"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  Minus,
  Wallet,
} from "lucide-react";
import { Amount } from "@/components/money/amount";
import { toneFor, type BalanceTone } from "@/components/money/balance-tone";
import { RemindButton } from "@/components/reminders/remind-button";
import { settleIntentPath } from "@/components/entries/settle-intent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useNumberLocale } from "@/i18n/format-context";
import { formatMoney, money } from "@/modules/currencies/money";
import type { RemindRecipient } from "@/modules/reminders/types";
import { PUSH } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

export interface CurrencyMemberView {
  readonly participantId: string;
  readonly name: string;
  /** Signed minor units: positive means this person is owed. */
  readonly minorUnits: string;
  readonly isSelf: boolean;
}

export interface CurrencyTransferView {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly minorUnits: string;
  readonly fromIsSelf: boolean;
  readonly toIsSelf: boolean;
}

export interface CurrencyBalanceView {
  readonly currency: string;
  /** All-time group spend in this currency, in minor units. */
  readonly totalSpent: string;
  readonly expenseCount: number;
  /** The reader's own signed balance. */
  readonly position: string;
  readonly members: readonly CurrencyMemberView[];
  readonly transfers: readonly CurrencyTransferView[];
}

const TONE: Record<BalanceTone, string> = {
  positive: "text-positive-ink",
  negative: "text-negative-ink",
  neutral: "text-neutral-balance-ink",
};

/**
 * Every currency the group has money in, one collapsed row each.
 *
 * The screen this replaces printed each currency's balances in full, one under
 * the other, so a group kept in four currencies was three screens of scrolling
 * before the reader reached the thing they came for. The row header carries
 * what a glance needs — which currency, what it cost, how many payments would
 * clear it, and where the reader stands — and the rest waits behind a tap.
 * Screen length is then roughly constant from two currencies to six.
 *
 * One row is open at a time, on purpose. Two open rows put two sets of member
 * balances on screen in two different currencies, which is precisely the
 * comparison this app refuses to invite.
 */
export function CurrencyBalances({
  currencies,
  groupId,
  groupName,
  senderName,
  recipients,
  participantCount,
  defaultOpen,
}: {
  currencies: readonly CurrencyBalanceView[];
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
  participantCount: number;
  /** Which row lands open. Chosen by `mainCurrencyOf`, never derived here. */
  defaultOpen: string | null;
}) {
  const t = useTranslations("group");
  const [open, setOpen] = useState<string | null>(defaultOpen);

  const payments = currencies.reduce(
    (total, entry) => total + entry.transfers.length,
    0,
  );

  return (
    <section
      aria-labelledby="balances-by-currency"
      className="flex flex-col gap-2.5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="balances-by-currency" className="text-sm font-medium">
          {t("balancesByCurrency")}
        </h2>
        <p className="text-xs text-muted-foreground">
          {t("currencyPeopleMeta", {
            currencies: currencies.length,
            people: participantCount,
          })}
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl bg-card ring-1 ring-border">
        {currencies.map((entry) => (
          <CurrencyRow
            key={entry.currency}
            entry={entry}
            groupId={groupId}
            groupName={groupName}
            senderName={senderName}
            recipients={recipients}
            expanded={open === entry.currency}
            // Tapping the open row closes it and leaves none open; tapping any
            // other opens it and closes whichever was.
            onToggle={() =>
              setOpen((current) =>
                current === entry.currency ? null : entry.currency,
              )
            }
          />
        ))}

        {payments > 0 && (
          <Link
            href={`/groups/${groupId}/settle`}
            transitionTypes={PUSH}
            // Two stacked lines run together into one word in an accessible
            // name, so the button states its own.
            aria-label={t("viewSuggestedSettlement")}
            className="flex min-h-11 items-center justify-between gap-3 border-t bg-muted/50 px-4 py-3.5 transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <ArrowRight
                aria-hidden="true"
                className="size-[17px] shrink-0 text-primary-ink"
              />
              <span aria-hidden="true" className="flex min-w-0 flex-col">
                <span className="truncate text-xs font-semibold">
                  {t("viewSuggestedSettlement")}
                </span>
                <span className="truncate text-2xs text-muted-foreground">
                  {t("settlementPlanMeta", {
                    payments,
                    currencies: currencies.length,
                  })}
                </span>
              </span>
            </span>
            <ChevronRight
              aria-hidden="true"
              className="size-[15px] shrink-0 text-muted-foreground"
            />
          </Link>
        )}
      </div>
    </section>
  );
}

function CurrencyRow({
  entry,
  groupId,
  groupName,
  senderName,
  recipients,
  expanded,
  onToggle,
}: {
  entry: CurrencyBalanceView;
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const t = useTranslations("group");
  const locale = useNumberLocale();
  const bodyId = useId();

  const tone = toneFor(entry.position);
  const position = BigInt(entry.position);
  const magnitude = position < 0n ? -position : position;
  const spent = formatMoney(money(BigInt(entry.totalSpent), entry.currency), {
    locale,
    display: "none",
  });
  // A settled currency has nothing to clear, so the clause that would count
  // its payments is dropped rather than printed as a zero.
  const meta =
    tone === "neutral"
      ? t("currencySpent", { amount: spent })
      : t("currencySpentPayments", {
          amount: spent,
          count: entry.transfers.length,
        });

  const outstanding = entry.members.filter(
    (member) => BigInt(member.minorUnits) !== 0n,
  );

  return (
    <div className="border-t first:border-t-0">
      <h3>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={onToggle}
          className="flex min-h-11 w-full items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none motion-reduce:transition-none"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <span
              className={cn(
                "min-w-[34px] shrink-0 text-xs font-semibold tracking-[0.05em]",
                tone === "neutral" && "text-muted-foreground",
              )}
            >
              {entry.currency}
            </span>
            <span className="truncate text-xs text-muted-foreground">
              {meta}
            </span>
          </span>

          <span className="flex shrink-0 items-center gap-2">
            {tone === "neutral" ? (
              <span className="flex items-center gap-[5px] text-xs font-medium text-neutral-balance-ink">
                <Minus aria-hidden="true" className="size-[15px] shrink-0" />
                {t("settledUpRow")}
              </span>
            ) : (
              <span
                className={cn(
                  "flex items-center gap-[5px] text-sm font-semibold",
                  TONE[tone],
                )}
              >
                <DirectionArrow tone={tone} className="size-[14px]" />
                {/* The section heading names no side, so every amount under it
                    carries its own word — hidden here only because the arrow
                    and the colour already say it to anyone who can see them. */}
                <span className="sr-only">
                  {tone === "positive" ? t("youGetBackWord") : t("youOweWord")}
                </span>
                <Amount
                  minorUnits={magnitude.toString()}
                  currency={entry.currency}
                  display="none"
                />
              </span>
            )}
            <ChevronDown
              aria-hidden="true"
              className={cn(
                "size-[15px] shrink-0 text-muted-foreground transition-transform duration-150 motion-reduce:transition-none",
                expanded && "rotate-180",
              )}
            />
          </span>
        </button>
      </h3>

      {/* Height animates from nothing to the body's own height without anyone
          measuring it: a grid row travels 0fr → 1fr, and the child clips.
          The body stays mounted so `aria-controls` has something to point at,
          and `inert` is what keeps a closed one out of the reading order. */}
      <div
        className={cn(
          "grid transition-[grid-template-rows] duration-150 motion-reduce:transition-none",
          expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]",
        )}
      >
        <div id={bodyId} inert={!expanded} className="overflow-hidden">
          <div className="flex flex-col gap-3 px-4 pt-1 pb-3.5">
            {outstanding.length === 0 ? (
              <p className="text-xs text-pretty text-muted-foreground">
                {t("everyoneSquare", {
                  currency: entry.currency,
                  count: entry.expenseCount,
                  amount: spent,
                })}
              </p>
            ) : (
              <>
                {entry.members.map((member) => (
                  <MemberLine
                    key={member.participantId}
                    member={member}
                    currency={entry.currency}
                  />
                ))}
                {entry.transfers.map((transfer) => (
                  <TransferLine
                    key={`${transfer.fromParticipantId}-${transfer.toParticipantId}`}
                    transfer={transfer}
                    currency={entry.currency}
                    groupId={groupId}
                    groupName={groupName}
                    senderName={senderName}
                    recipients={recipients}
                  />
                ))}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function DirectionArrow({
  tone,
  className,
}: {
  tone: BalanceTone;
  className: string;
}) {
  const Glyph = tone === "positive" ? ArrowDownLeft : ArrowUpRight;
  return <Glyph aria-hidden="true" className={cn("shrink-0", className)} />;
}

/** One person's standing in this currency. No currency code: the row named it. */
function MemberLine({
  member,
  currency,
}: {
  member: CurrencyMemberView;
  currency: string;
}) {
  const t = useTranslations("group");
  const tone = toneFor(member.minorUnits);
  const value = BigInt(member.minorUnits);
  const magnitude = value < 0n ? -value : value;

  const name = member.isSelf ? t("you") : member.name;
  const direction = member.isSelf
    ? tone === "positive"
      ? t("youGetBackWord")
      : t("youOweWord")
    : tone === "positive"
      ? t("getsBackWord")
      : t("owesWord");

  return (
    <div className="flex items-center justify-between gap-3">
      <span className="flex min-w-0 items-center gap-2.5">
        <Avatar className="size-7 shrink-0">
          <AvatarFallback
            className={cn(
              "text-2xs font-semibold",
              member.isSelf
                ? "bg-primary/15 text-primary-ink"
                : "bg-accent text-accent-foreground",
            )}
          >
            {name.trim().charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "truncate text-sm font-medium",
            tone === "neutral" && "text-muted-foreground",
          )}
        >
          {name}
        </span>
        {tone !== "neutral" && (
          <span className="shrink-0 text-2xs font-normal text-muted-foreground">
            {direction}
          </span>
        )}
      </span>

      {tone === "neutral" ? (
        <span className="shrink-0 text-xs font-medium text-neutral-balance-ink">
          {t("settledUpRow")}
        </span>
      ) : (
        <span
          className={cn(
            "flex shrink-0 items-center gap-1.5 text-sm font-semibold",
            TONE[tone],
          )}
        >
          <DirectionArrow tone={tone} className="size-[15px]" />
          <Amount
            minorUnits={magnitude.toString()}
            currency={currency}
            display="none"
          />
        </span>
      )}
    </div>
  );
}

/**
 * One transfer that would clear part of this currency, with the one thing the
 * reader can do about it attached.
 *
 * A debt between two other people gets no button: reminding on someone else's
 * behalf is deliberately absent from this app, and paying it is not the
 * reader's to do.
 */
function TransferLine({
  transfer,
  currency,
  groupId,
  groupName,
  senderName,
  recipients,
}: {
  transfer: CurrencyTransferView;
  currency: string;
  groupId: string;
  groupName: string;
  senderName: string;
  recipients: readonly RemindRecipient[];
}) {
  const t = useTranslations("group");
  const debtor = recipients.filter(
    (recipient) => recipient.participantId === transfer.fromParticipantId,
  );

  return (
    <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2.5">
      <span className="flex min-w-0 items-center gap-2 text-xs font-medium">
        <span className="truncate">
          {transfer.fromIsSelf ? t("youLower") : transfer.fromName}
        </span>
        <ArrowRight
          aria-hidden="true"
          className="size-[14px] shrink-0 text-muted-foreground"
        />
        <span className="truncate">
          {transfer.toIsSelf ? t("youLower") : transfer.toName}
        </span>
        <Amount
          minorUnits={transfer.minorUnits}
          currency={currency}
          display="none"
          className="shrink-0 font-semibold"
        />
      </span>

      {transfer.fromIsSelf ? (
        <Button
          asChild
          size="sm"
          // 28px tall as drawn, with the hit target the pattern owes a thumb
          // grown around it rather than into the layout.
          className="relative h-7 shrink-0 rounded-full px-2.5 text-2xs font-semibold after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
        >
          <Link
            href={settleIntentPath(groupId, {
              fromParticipantId: transfer.fromParticipantId,
              toParticipantId: transfer.toParticipantId,
              currency,
            })}
          >
            <Wallet aria-hidden="true" className="size-[13px]" />
            {t("payTransfer")}
          </Link>
        </Button>
      ) : transfer.toIsSelf && debtor.length > 0 ? (
        <RemindButton
          groupId={groupId}
          groupName={groupName}
          senderName={senderName}
          recipients={debtor}
          variant="outline"
          className="relative h-7 shrink-0 rounded-full bg-card px-2.5 text-2xs font-medium after:absolute after:inset-x-0 after:-inset-y-2 after:content-['']"
        />
      ) : null}
    </div>
  );
}
