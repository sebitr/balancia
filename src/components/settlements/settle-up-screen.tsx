"use client";

import { useState } from "react";
import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import { ArrowDownLeft, ArrowUpRight, Check, ChevronRight } from "lucide-react";
import { Amount } from "@/components/money/amount";
import { RemindButton } from "@/components/reminders/remind-button";
import {
  PayoutHint,
  type PayoutMethodChoice,
} from "@/components/payouts/payout-hint";
import type {
  PaymentQrRefusal,
  PaymentQrStandard,
} from "@/modules/payouts/qr/payment-qr";
import { settleIntentPath } from "@/components/entries/settle-intent";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
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

/** Every way one person accepts money, for the row that owes them. */
export interface PayoutHintView {
  readonly participantId: string;
  /**
   * The currency of the debt this hint belongs to. Part of the key rather than
   * decoration: a reader can owe one person in two currencies, and the two
   * rows are two different payments with two different codes.
   */
  readonly currency: string;
  /**
   * In the owner's own order — `payoutMethods.position` — so the first is the
   * one they would rather have and the rest are the alternatives they are
   * willing to take. Never empty: a participant with nothing listed produces
   * no hint at all.
   */
  readonly methods: readonly PayoutMethodChoice[];
  /**
   * The leading payment code, built on the server because only the server
   * holds the creditor's address.
   *
   * Each entry in `methods` now carries its own code, and this is whichever of
   * them is the first to have one — so it is what the row shows before the
   * reader picks a chip, and not a separate answer. Null whenever no method
   * can produce a code correctly, which is still the common case.
   */
  readonly qr: { standard: PaymentQrStandard; payload: string } | null;
  /**
   * Why there is no code, when it is a reason the reader can act on. Null
   * both when there is a code and when the reason is not worth a sentence.
   */
  readonly qrMissing: PaymentQrRefusal | null;
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
      <div className="flex flex-col gap-1">
        <PageHeader
          title={t("title")}
          back={{
            href: `/groups/${shared.groupId}`,
            label: t("backToGroup"),
          }}
        />
        {/* Which group, and how much of it this plan covers. It reads as a
            line under the title, so it is indented to sit under the words
            rather than under the arrow. */}
        <p className="truncate pl-10.5 text-xs text-muted-foreground">
          {subtitle}
        </p>
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
        <p className="text-sm font-medium text-neutral-balance-ink">
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
  const format = useFormatter();
  const involved = transfer.fromIsSelf || transfer.toIsSelf;

  // Shown only on a row the reader is the one paying: it answers "where do I
  // send it", which nobody else on this screen is asking.
  const payout = transfer.fromIsSelf
    ? shared.payoutHints.find(
        (hint) =>
          hint.participantId === transfer.toParticipantId &&
          hint.currency === transfer.currency,
      )
    : undefined;

  /*
   * Which method the reader is looking at, and therefore the one they are
   * about to use.
   *
   * Held here rather than inside the hint because the record button is the
   * other half of the answer: the drawer that opens next should already say
   * TWINT if TWINT is what is on screen, and it cannot know that from a state
   * kept below it. Starts on the payee's own first choice, which is what the
   * row showed before this screen had a menu.
   */
  const [picked, setPicked] = useState(() => payout?.methods[0]?.method ?? "");

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
    // Only ever the reader's own choice about their own debt. A row between
    // two other people states no method, because nobody here has picked one.
    method: picked || null,
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

  /*
   * A row between two other people is the whole target.
   *
   * Nothing on it is copyable, nothing about it can be chased, and the one
   * thing it offers — recording that they squared up — used to be a small
   * button off to the right with sixty pixels of dead row beside it. The
   * sentence is what the reader aims at, so the sentence is the button.
   */
  if (!involved) {
    return (
      <Link
        href={recordHref}
        // Two stacked lines in one control run together into "Poul pays
        // SebRecord for them" for a screen reader, so the row states its own
        // name rather than being read out of its parts.
        aria-label={recordLabel}
        className="flex min-h-[60px] items-center gap-3 border-t py-3 pr-3.5 pl-4 transition-colors hover:bg-white/4"
      >
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
          <p className="truncate text-xs text-muted-foreground">
            {t("recordForThem")}
          </p>
        </div>

        <TransferAmount transfer={transfer} />
        <ChevronRight
          aria-hidden="true"
          className="size-4 shrink-0 text-muted-foreground"
        />
      </Link>
    );
  }

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

      {/* A rule between the debt and the ways to pay it. The row is two things
          now — what is owed, and how to hand it over — and without the line the
          chips read as a third row of the sentence above them. */}
      {payout && (
        <PayoutHint
          className="border-t pt-3"
          name={transfer.toName}
          groupName={shared.groupName}
          methods={payout.methods}
          picked={picked}
          onPick={setPicked}
          minorUnits={transfer.minorUnits}
          currency={transfer.currency}
          qr={payout.qr}
          qrMissing={payout.qrMissing}
        />
      )}

      {/* Wraps, because one of these buttons carries a name. "Relancer Grace"
          and "J'ai reçu le paiement" fit beside each other on a 375px phone;
          "Relancer Katherine" and the same second button need 356px of a 311px
          row, and `flex-1` cannot rescue that — `min-width: auto` holds every
          flex item at its label's min-content width, so instead of shrinking,
          the second button ran 13px off the side of the screen with its label
          cut mid-word. Wrapping puts it on its own line, where `flex-1` gives
          it the full width. A longer translation lands the same way. */}
      <div className="flex flex-wrap items-center gap-2">
        {transfer.fromIsSelf ? (
          /* First person, and past tense. The button does not move the money —
             nothing here does — so it must not read like an instruction that
             would. What it records is something the reader has already gone
             and done. */
          <Button
            asChild
            size="lg"
            className="h-[46px] flex-1 rounded-[14px] text-sm font-semibold"
          >
            <Link href={recordHref} aria-label={recordLabel}>
              {t("iPaid", { name: transfer.toName })}
            </Link>
          </Button>
        ) : (
          <>
            {recipients.length > 0 && (
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
              className="h-[46px] flex-1 rounded-[14px] text-sm font-medium"
            >
              <Link href={recordHref} aria-label={recordLabel}>
                {t("iWasPaid")}
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
        outgoing && "text-negative-ink",
        incoming && "text-positive-ink",
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
