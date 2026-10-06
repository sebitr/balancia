"use client";

import { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { PayoutHint } from "@/components/payouts/payout-hint";
import { RemindButton } from "@/components/reminders/remind-button";
import { settleIntentPath } from "@/components/entries/settle-intent";
import type { RemindRecipient } from "@/modules/reminders/types";
import { cn } from "@/lib/utils";
import type { PayoutHintView, SettleUpTransferView } from "./settle-up-screen";

/**
 * What the reader can do about one payment they are a party to.
 *
 * The settle-up screen drew this under each of its rows, and a person's page
 * now draws it under "You owe Marta" too — the same debt, reached from the
 * other direction, so it is the same component rather than a second set of
 * buttons that would one day disagree with the first about what they say.
 *
 * Balancia never moves money, so the actions are only ever *record it* and
 * *ask for it*:
 *
 *  - **The reader owes.** "I paid Marta", opening the add-entry drawer on the
 *    settle tab with the pair and the currency already chosen. Where Marta has
 *    said how she likes to be paid, the panel that says it comes first and the
 *    button sits at its foot.
 *  - **The reader is owed.** "I was paid back", the same drawer the other way
 *    round, and "Remind" — offered only when the reminder flow has the person
 *    on its list, which is to say only when the debt is the reader's own.
 *
 * Neither button is an instruction. "Pay Marta back" on a button reads like
 * one that would send the money, and nothing here can; what the buttons
 * record is something the reader has already gone and done.
 */

export interface SettleActionsShared {
  readonly groupId: string;
  readonly groupName: string;
  readonly senderName: string;
  /** Everyone who owes the reader, from `listRemindRecipients`. */
  readonly recipients: readonly RemindRecipient[];
  /**
   * How the people the reader owes accept money. Only ever those people — see
   * `buildPayoutHints` — so there is no way to ask about anybody else.
   */
  readonly payoutHints: readonly PayoutHintView[];
}

/** The reminder rows that are about this payment's debtor, if it is owed to the reader. */
export function remindRecipientsFor(
  transfer: SettleUpTransferView,
  recipients: readonly RemindRecipient[],
): RemindRecipient[] {
  // Only debts owed *to* the reader can be chased, and only through the
  // reminder flow's own memory of who was asked when.
  return transfer.toIsSelf
    ? recipients.filter(
        (recipient) => recipient.participantId === transfer.fromParticipantId,
      )
    : [];
}

export function SettleActions({
  transfer,
  groupId,
  groupName,
  senderName,
  recipients,
  payoutHints,
}: SettleActionsShared & { transfer: SettleUpTransferView }) {
  const t = useTranslations("settleUp");

  // Shown only on a row the reader is the one paying: it answers "where do I
  // send it", which nobody else is asking.
  const payout = transfer.fromIsSelf
    ? payoutHints.find(
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
   * row showed before there was a menu.
   */
  const [picked, setPicked] = useState(() => payout?.methods[0]?.method ?? "");

  /*
   * Recording opens the add-entry drawer over this screen, on the settle tab,
   * with the pair already picked — the same drawer the bottom bar's Add opens,
   * rather than a second form that only knows how to write repayments.
   *
   * The amount is not on the link. The drawer prices the debt from the
   * balances it loads for itself, so what the form opens on is what is
   * outstanding when it opens rather than what this screen last rendered.
   */
  const recordHref = settleIntentPath(groupId, {
    fromParticipantId: transfer.fromParticipantId,
    toParticipantId: transfer.toParticipantId,
    currency: transfer.currency,
    // Only ever the reader's own choice about their own debt.
    method: picked || null,
  });

  const chaseable = remindRecipientsFor(transfer, recipients);

  const recordLabel = t("recordFor", {
    from: transfer.fromName,
    to: transfer.toName,
  });

  /*
   * The button that records it, which lives in one of two places.
   *
   * Where there are payment rails, it is the last thing in the panel: the
   * reader has just copied a number and gone to their bank, and the button
   * they come back to should be under the thing they used. Where there are
   * none, it is the payment's own action.
   */
  const record = (tall: boolean) => (
    <Button
      asChild
      size="lg"
      className={cn(
        "w-full font-semibold",
        tall ? "h-[50px] rounded-[16px] text-sm" : "h-[46px] rounded-[14px]",
      )}
    >
      {/* First person, and past tense. The button does not move the money —
          nothing here does — so it must not read like an instruction that
          would. What it records is something the reader has already gone and
          done. */}
      <Link href={recordHref} aria-label={recordLabel}>
        {t("iPaid", { name: transfer.toName })}
      </Link>
    </Button>
  );

  if (payout) {
    return (
      <PayoutHint
        name={transfer.toName}
        groupName={groupName}
        methods={payout.methods}
        picked={picked}
        onPick={setPicked}
        minorUnits={transfer.minorUnits}
        currency={transfer.currency}
        qr={payout.qr}
        qrMissing={payout.qrMissing}
        action={record(true)}
      />
    );
  }

  if (transfer.fromIsSelf) return record(false);

  // A payment between two other people is nothing the reader can do anything
  // about from here; the settle screen draws those rows on its own.
  if (!transfer.toIsSelf) return null;

  return (
    /* Wraps, because one of these buttons carries a name. "Relancer" and
       "J'ai reçu le paiement" fit beside each other on a 375px phone, and a
       longer translation of either does not — `flex-1` cannot rescue that,
       because `min-width: auto` holds every flex item at its label's
       min-content width, so instead of shrinking the second button runs off
       the side of the screen with its label cut mid-word. Wrapping puts it on
       its own line, where `flex-1` gives it the full width. */
    <div className="flex flex-wrap items-center gap-2.5">
      <Button
        asChild
        size="lg"
        className="h-[46px] flex-1 rounded-[14px] font-semibold"
      >
        <Link href={recordHref} aria-label={recordLabel}>
          {t("iWasPaid")}
        </Link>
      </Button>
      {chaseable.length > 0 && (
        <RemindButton
          groupId={groupId}
          groupName={groupName}
          senderName={senderName}
          recipients={chaseable}
          label={t("remindShort")}
          // The word on the button is short because the line above it says
          // who; out of that context — a screen reader running the buttons
          // of a screen with three of these — it would not.
          ariaLabel={t("remindPerson", { name: transfer.fromName })}
          variant="outline"
          className="h-[46px] rounded-[14px] px-4 font-medium"
        />
      )}
    </div>
  );
}
