"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import {
  ArrowDownLeft,
  ArrowLeft,
  ArrowUpRight,
  Check,
  ChevronRight,
} from "lucide-react";
import { Amount } from "@/components/money/amount";
import { RemindButton } from "@/components/reminders/remind-button";
import { PayoutHint } from "@/components/payouts/payout-hint";
import type { PaymentQrStandard } from "@/modules/payouts/qr/payment-qr";
import { settleIntentPath } from "@/components/entries/settle-intent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { useDateFormatter } from "@/i18n/format-context";
import type { RemindRecipient } from "@/modules/reminders/types";
import { POP } from "@/components/motion/transitions";
import { cn } from "@/lib/utils";

/**
 * Settle up: the shortest set of transfers that clears the group.
 *
 * Each transfer is a sentence — "Seb pays Amélie" — and carries the one action
 * that fits it. Balancia never moves money, so the actions are only ever
 * *record it* and *ask for it*, and both hand off to the flows that already
 * own those jobs rather than growing a second form here.
 *
 * Three rules the screen keeps to:
 *
 *  - **Currencies never meet.** A separate-currency group gets one card each,
 *    and a currency that is square says "settled up" instead of showing 0.00.
 *  - **Direction is said three ways** — the word order of the sentence, an
 *    arrow, and the colour — so it survives greyscale and a screen reader,
 *    per the design system's money rules.
 *  - **Nobody nudges on someone else's behalf.** Rows between two other people
 *    can be recorded, never reminded; see `modules/reminders/service`.
 */

export interface SettleUpTransferView {
  readonly fromParticipantId: string;
  readonly fromName: string;
  readonly toParticipantId: string;
  readonly toName: string;
  readonly currency: string;
  /** Minor units as a string, always positive. */
  readonly minorUnits: string;
  readonly fromIsSelf: boolean;
  readonly toIsSelf: boolean;
}

export interface SettleUpCurrencyView {
  readonly currency: string;
  readonly yours: readonly SettleUpTransferView[];
  readonly others: readonly SettleUpTransferView[];
}

export interface SettledRepaymentView {
  readonly id: string;
  readonly fromName: string;
  readonly toName: string;
  readonly currency: string;
  readonly minorUnits: string;
  readonly settledOn: string;
  readonly paymentMethod: string | null;
}

/** One person's preferred way of being paid, for the rows that owe them. */
export interface PayoutHintView {
  readonly participantId: string;
  readonly method: string;
  readonly detail: string;
  /**
   * The payment code, built on the server because only the server holds the
   * creditor's address. Null whenever one cannot be built correctly — a
   * missing address, a QR-IBAN, a currency neither standard carries — which is
   * the common case rather than the exception.
   */
  readonly qr: { standard: PaymentQrStandard; payload: string } | null;
}

interface Shared {
  readonly groupId: string;
  readonly groupName: string;
  readonly senderName: string;
  readonly recipients: readonly RemindRecipient[];
  readonly currencyMode: "separate" | "converted";
  readonly baseCurrency: string | null;
  /**
   * Only ever the people this reader owes. The page collects them from the
   * transfers it has already computed, so there is no way to ask about anybody
   * else — which is the whole of the rule that payout details are visible to
   * the people who owe you and to nobody else.
   */
  readonly payoutHints: readonly PayoutHintView[];
}

export function SettleUpScreen({
  currencies,
  transferCount,
  lastSettled,
  participantCount,
  ...shared
}: Shared & {
  currencies: readonly SettleUpCurrencyView[];
  transferCount: number;
  lastSettled: readonly SettledRepaymentView[];
  participantCount: number;
}) {
  const t = useTranslations("settleUp");
  const tCommon = useTranslations("common");
  const converted = shared.currencyMode === "converted";

  const subtitle = converted
    ? t("subtitleConverted", {
        group: shared.groupName,
        currency: shared.baseCurrency ?? currencies[0]?.currency ?? "",
      })
    : t("subtitlePeople", {
        group: shared.groupName,
        count: participantCount,
      });

  return (
    <div className="flex flex-col gap-3.5">
      <div>
        <Button asChild variant="ghost" size="sm" className="-ml-2">
          <Link href={`/groups/${shared.groupId}`} transitionTypes={POP}>
            <ArrowLeft aria-hidden="true" />
            {tCommon("back")}
          </Link>
        </Button>
      </div>

      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-[-0.025em]">
          {t("title")}
        </h1>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>

      {transferCount === 0 ? (
        <NothingToSettle groupId={shared.groupId} lastSettled={lastSettled} />
      ) : (
        <div className="mt-1 flex flex-col gap-3.5">
          {/* A converted group settles in one currency, so the count is the
              whole plan and belongs at the top of the screen. A group holding
              several has one count per card instead — there is no number that
              covers all of them without adding currencies together. */}
          {converted && (
            <h2 className="text-lg font-semibold tracking-[-0.025em]">
              {t("clearsGroup", { count: transferCount })}
            </h2>
          )}

          {currencies.map((entry) => (
            <CurrencyCard
              key={entry.currency}
              entry={entry}
              showHead={!converted}
              {...shared}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * One currency's card, or one card for the whole group when it converts.
 *
 * The group labels appear only when there is something in both groups: a card
 * holding a single transfer needs no heading to tell the reader which of two
 * lists they are looking at.
 */
function CurrencyCard({
  entry,
  showHead,
  ...shared
}: Shared & { entry: SettleUpCurrencyView; showHead: boolean }) {
  const t = useTranslations("settleUp");
  const count = entry.yours.length + entry.others.length;

  if (count === 0) {
    return (
      <section className="flex items-center justify-between gap-3 rounded-[18px] bg-card px-4 py-4 ring-1 ring-border">
        <h2 className="text-2xs font-bold tracking-[0.1em] uppercase">
          {entry.currency}
        </h2>
        {/* Never `0.00`: a currency nobody owes anything in has no amount, and
            printing one invites the reader to look for what it refers to. */}
        <p className="text-sm font-medium text-neutral-balance">
          {t("settledUp")}
        </p>
      </section>
    );
  }

  const labelled = entry.yours.length > 0 && entry.others.length > 0;

  return (
    <section
      aria-labelledby={`settle-${entry.currency}`}
      className="overflow-hidden rounded-[18px] bg-card ring-1 ring-border"
    >
      {showHead ? (
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-4 pt-4 pb-3">
          <h2
            id={`settle-${entry.currency}`}
            className="text-2xs font-bold tracking-[0.1em] uppercase"
          >
            {entry.currency}
          </h2>
          <p className="text-xs text-muted-foreground">
            {t("clearsCurrency", { count })}
          </p>
        </div>
      ) : (
        <h2 id={`settle-${entry.currency}`} className="sr-only">
          {entry.currency}
        </h2>
      )}

      {entry.yours.length > 0 && (
        <>
          {labelled && <GroupLabel>{t("yourPayments")}</GroupLabel>}
          {entry.yours.map((transfer) => (
            <TransferRow
              key={rowKey(transfer)}
              transfer={transfer}
              {...shared}
            />
          ))}
        </>
      )}

      {entry.others.length > 0 && (
        <>
          {labelled && <GroupLabel>{t("betweenOthers")}</GroupLabel>}
          {entry.others.map((transfer) => (
            <TransferRow
              key={rowKey(transfer)}
              transfer={transfer}
              {...shared}
            />
          ))}
        </>
      )}
    </section>
  );
}

function GroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-t bg-background px-4 pt-2.5 pb-2 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </p>
  );
}

function rowKey(transfer: SettleUpTransferView): string {
  return `${transfer.fromParticipantId}-${transfer.toParticipantId}-${transfer.currency}-${transfer.minorUnits}`;
}

/**
 * One transfer: who pays whom, how much, and what to do about it.
 *
 * The reader's own debt is the only tinted row on the screen — it is the one
 * thing here they can settle without waiting on anybody.
 */
function TransferRow({
  transfer,
  ...shared
}: Shared & { transfer: SettleUpTransferView }) {
  const t = useTranslations("settleUp");
  const tMethods = useTranslations("paymentMethods");
  const format = useFormatter();
  const involved = transfer.fromIsSelf || transfer.toIsSelf;

  // The face is whoever the row is about from here: the other party when the
  // reader is in the sentence, and the person who owes when they are not.
  const face = transfer.fromIsSelf ? transfer.toName : transfer.fromName;

  /*
   * Recording opens the add-entry drawer over this screen, on the settle tab,
   * with the pair already picked — the same drawer the bottom bar's Add opens,
   * rather than a second form that only knows how to write repayments.
   *
   * The amount is not on the link. The drawer prices the debt from the
   * balances it loads for itself, so what the form opens on is what is
   * outstanding when it opens rather than what this screen last rendered.
   */
  const recordHref = settleIntentPath(shared.groupId, {
    fromParticipantId: transfer.fromParticipantId,
    toParticipantId: transfer.toParticipantId,
    currency: transfer.currency,
  });

  // Only debts owed *to* the reader can be chased, and only through the
  // reminder flow's own memory of who was asked when.
  const recipients = transfer.toIsSelf
    ? shared.recipients.filter(
        (recipient) => recipient.participantId === transfer.fromParticipantId,
      )
    : [];
  const reminded = recipients.find(
    (recipient) => recipient.lastRemindedAt !== null,
  )?.lastRemindedAt;

  const recordLabel = t("recordFor", {
    from: transfer.fromName,
    to: transfer.toName,
  });

  // Shown only on a row the reader is the one paying: it answers "where do I
  // send it", which nobody else on this screen is asking.
  const payout = transfer.fromIsSelf
    ? shared.payoutHints.find(
        (hint) => hint.participantId === transfer.toParticipantId,
      )
    : undefined;

  return (
    <div
      className={cn(
        "flex flex-col gap-3 border-t px-4 py-3.5",
        transfer.fromIsSelf && "bg-primary/5",
      )}
    >
      <div className="flex items-center gap-3">
        <Avatar className="size-9 shrink-0">
          <AvatarFallback className="bg-accent text-xs font-semibold text-accent-foreground">
            {initialsOf(face)}
          </AvatarFallback>
        </Avatar>

        <div className="flex min-w-0 flex-col gap-0.5">
          <p className="truncate text-sm font-medium tracking-[-0.01em]">
            {t("paysSentence", {
              from: transfer.fromName,
              to: transfer.toName,
            })}
          </p>
          {reminded && (
            <p className="truncate text-xs text-muted-foreground">
              {t("remindedWhen", {
                when: format.relativeTime(new Date(reminded)),
              })}
            </p>
          )}
        </div>

        <TransferAmount transfer={transfer} />
      </div>

      {payout && (
        <PayoutHint
          name={transfer.toName}
          method={payout.method}
          detail={payout.detail}
          methodLabel={tMethods(
            payout.method as Parameters<typeof tMethods>[0],
          )}
          qr={payout.qr}
        />
      )}

      <div className="flex items-center gap-2">
        {transfer.fromIsSelf ? (
          <Button
            asChild
            size="lg"
            className="h-[46px] flex-1 rounded-[14px] text-sm font-semibold"
          >
            <Link href={recordHref} aria-label={recordLabel}>
              {t("record")}
            </Link>
          </Button>
        ) : (
          <>
            {transfer.toIsSelf && recipients.length > 0 && (
              <RemindButton
                groupId={shared.groupId}
                groupName={shared.groupName}
                senderName={shared.senderName}
                recipients={recipients}
                label={t("remindPerson", { name: transfer.fromName })}
                variant="default"
                className="h-[46px] flex-1 rounded-[14px] text-sm font-semibold"
              />
            )}
            <Button
              asChild
              variant="outline"
              size="lg"
              className={cn(
                "rounded-[14px] font-medium",
                // A row the reader is part of gets the full 44px target beside
                // its primary action; one between two other people is the
                // quiet case and takes the small recipe, right-aligned.
                involved
                  ? "h-[46px] flex-1 text-sm"
                  : "ml-auto h-9 px-3.5 text-xs",
              )}
            >
              <Link href={recordHref} aria-label={recordLabel}>
                {t("record")}
                <ChevronRight
                  aria-hidden="true"
                  className="text-muted-foreground"
                />
              </Link>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The figure, with its direction said in colour and in an arrow as well as in
 * the sentence beside it. A transfer between two other people is neither
 * coming nor going, so it carries neither.
 */
function TransferAmount({ transfer }: { transfer: SettleUpTransferView }) {
  const outgoing = transfer.fromIsSelf;
  const incoming = transfer.toIsSelf;

  return (
    <span
      className={cn(
        "ml-auto flex shrink-0 items-center gap-1",
        outgoing && "text-negative",
        incoming && "text-positive",
      )}
    >
      {outgoing && <ArrowUpRight aria-hidden="true" className="size-[15px]" />}
      {incoming && <ArrowDownLeft aria-hidden="true" className="size-[15px]" />}
      <Amount
        minorUnits={transfer.minorUnits}
        currency={transfer.currency}
        display="code"
        className={cn(
          "text-sm",
          outgoing || incoming ? "font-semibold" : "font-medium",
        )}
      />
    </span>
  );
}

/** Nothing owed anywhere: what happened last, and the way back. */
function NothingToSettle({
  groupId,
  lastSettled,
}: {
  groupId: string;
  lastSettled: readonly SettledRepaymentView[];
}) {
  const t = useTranslations("settleUp");
  const dates = useDateFormatter();

  return (
    <div className="mt-1 flex flex-col gap-3.5">
      <EmptyState
        icon={Check}
        title={t("allSettledTitle")}
        description={t("allSettledDescription")}
        className="rounded-[18px] px-7 py-13"
      />

      {lastSettled.length > 0 && (
        <section
          aria-labelledby="last-settled"
          className="overflow-hidden rounded-[18px] bg-card ring-1 ring-border"
        >
          <h2
            id="last-settled"
            className="px-4 pt-4 pb-3 text-2xs font-semibold tracking-[0.08em] text-muted-foreground uppercase"
          >
            {t("lastSettled")}
          </h2>
          <ul>
            {lastSettled.map((repayment) => (
              <li
                key={repayment.id}
                className="flex items-center gap-3 border-t px-4 py-3"
              >
                <Avatar className="size-8 shrink-0">
                  <AvatarFallback className="bg-accent text-2xs font-semibold text-accent-foreground">
                    {initialsOf(repayment.fromName)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex min-w-0 flex-col gap-0.5">
                  <p className="truncate text-sm font-medium">
                    {t("paidSentence", {
                      from: repayment.fromName,
                      to: repayment.toName,
                    })}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {repayment.paymentMethod
                      ? t("settledOnVia", {
                          when: dates.plain(repayment.settledOn),
                          method: repayment.paymentMethod,
                        })
                      : dates.plain(repayment.settledOn)}
                  </p>
                </div>
                <Amount
                  minorUnits={repayment.minorUnits}
                  currency={repayment.currency}
                  display="code"
                  className="ml-auto shrink-0 text-sm font-medium"
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      <Button
        asChild
        variant="outline"
        size="lg"
        className="mx-auto h-11 rounded-[14px] px-5 text-sm font-medium"
      >
        <Link href={`/groups/${groupId}`} transitionTypes={POP}>
          {t("backToGroup")}
        </Link>
      </Button>
    </div>
  );
}

/**
 * Up to two letters, from the first two words of a name.
 *
 * A one-word display name gives one letter, which is what the rest of the app
 * shows; a name with a surname gives both, which is what tells two Jonases
 * apart in a group that has them.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words
    .slice(0, 2)
    .map((word) => [...word][0].toUpperCase())
    .join("");
}
