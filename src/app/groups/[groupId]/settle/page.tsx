import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettleUpScreen } from "@/components/settlements/settle-up-screen";
import { requireGroupAccess } from "@/lib/actions";
import { listParticipants } from "@/modules/groups/service";
import { listRemindRecipients } from "@/modules/reminders/service";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import {
  listPayoutAddressesOwed,
  listPayoutsOwed,
} from "@/modules/payouts/service";
import {
  buildPaymentQr,
  explainMissingQr,
} from "@/modules/payouts/qr/payment-qr";

/**
 * Settle up.
 *
 * Reached from the group overview, from the position card's own action and
 * from "View all" beside the suggested settlements — the three places that ask
 * "who owes whom" and hand the answer over here.
 *
 * Everything the screen shows comes from one balance load. The suggested
 * transfers, the currencies that are already square and the count in the lead
 * sentence are all read off the same pass, so no two blocks on the screen can
 * disagree about when they were read.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("settleUp");
  return { title: t("title") };
}

export default async function SettleUpPage({
  params,
}: PageProps<"/groups/[groupId]/settle">) {
  const { groupId } = await params;
  const access = await requireGroupAccess(groupId);

  const [view, recipients, participants] = await Promise.all([
    loadSettleUp(access),
    listRemindRecipients(access),
    listParticipants(access.groupId),
  ]);

  /*
   * Every debt this reader has been told to pay, one row of the screen each.
   *
   * The hints are built from the transfers rather than from the recipients,
   * because a payment code is made of a debt and not of a person: in a group
   * balancing in two currencies you can owe the same person twice, and one
   * hint per person would have put the same code — one amount, one currency —
   * on both of those rows.
   */
  const debts = view.currencies.flatMap((entry) =>
    [...entry.yours, ...entry.others].filter((transfer) => transfer.fromIsSelf),
  );

  /*
   * The payout details of the people this reader owes, and of nobody else.
   *
   * The recipients are read off the transfers that were just computed, so the
   * permission is structural rather than checked: a participant reaches this
   * list only by appearing in a debt the balances say the reader has. There is
   * no endpoint that answers "show me their IBAN".
   */
  const owed = debts.map((transfer) => transfer.toParticipantId);
  const [payouts, addresses] = await Promise.all([
    listPayoutsOwed(access.groupId, owed),
    listPayoutAddressesOwed(access.groupId, owed),
  ]);

  const payoutHints = debts.flatMap((transfer) => {
    const top = payouts.get(transfer.toParticipantId)?.[0];
    if (!top) return [];

    /*
     * A code is only built for a bank transfer, and only when everything the
     * standard needs is present. A TWINT number is not something a banking app
     * scans, and a Swiss account with no address on file is a code that would
     * be refused — so both come back as no code at all rather than as one that
     * fails at the till.
     *
     * The amount comes from the transfer the row is showing, so the code can
     * never name a figure that is not on screen beside it.
     */
    const request =
      top.method === "bank"
        ? {
            iban: top.detail,
            creditorName: transfer.toName,
            address: addresses.get(transfer.toParticipantId) ?? null,
            minorUnits: transfer.amount.toString(),
            currency: transfer.currency,
            message: access.group.name,
          }
        : null;

    const qr = request ? buildPaymentQr(request) : null;

    /*
     * And when there is none, why.
     *
     * Only for a bank transfer, and only for the reasons somebody can do
     * something about — `explainMissingQr` answers "none" for the rest, and
     * "none" stays silent. A sentence the reader can act on beats a blank
     * where they expected a code; a sentence they cannot act on is worse than
     * the blank, because it costs them a read to find that out.
     */
    const missing = request && !qr ? explainMissingQr(request) : "none";

    return [
      {
        participantId: transfer.toParticipantId,
        currency: transfer.currency,
        method: top.method,
        detail: top.detail,
        qr,
        qrMissing: missing === "none" ? null : missing,
      },
    ];
  });

  const senderName =
    access.actor.kind === "guest"
      ? access.actor.displayName
      : access.actor.name;

  return (
    <SettleUpScreen
      currencies={view.currencies.map((entry) => ({
        currency: entry.currency,
        yours: entry.yours.map(toView),
        others: entry.others.map(toView),
      }))}
      transferCount={view.transferCount}
      payoutHints={payoutHints}
      lastSettled={view.lastSettled.map((repayment) => ({
        id: repayment.id,
        fromName: repayment.fromName,
        toName: repayment.toName,
        currency: repayment.currency,
        minorUnits: repayment.amount.toString(),
        settledOn: repayment.settledOn,
        paymentMethod: repayment.paymentMethod,
      }))}
      participantCount={participants.length}
      groupId={groupId}
      groupName={access.group.name}
      senderName={senderName}
      recipients={recipients}
      currencyMode={access.group.currencyMode}
      baseCurrency={access.group.baseCurrency}
    />
  );
}

/** Minor units cross to the client as strings; a bigint would not survive. */
function toView(transfer: {
  fromParticipantId: string;
  fromName: string;
  toParticipantId: string;
  toName: string;
  currency: string;
  amount: bigint;
  fromIsSelf: boolean;
  toIsSelf: boolean;
}) {
  return {
    fromParticipantId: transfer.fromParticipantId,
    fromName: transfer.fromName,
    toParticipantId: transfer.toParticipantId,
    toName: transfer.toName,
    currency: transfer.currency,
    minorUnits: transfer.amount.toString(),
    fromIsSelf: transfer.fromIsSelf,
    toIsSelf: transfer.toIsSelf,
  };
}
