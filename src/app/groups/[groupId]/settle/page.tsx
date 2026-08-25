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
import { buildPaymentQr } from "@/modules/payouts/qr/payment-qr";

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
   * The payout details of the people this reader owes, and of nobody else.
   *
   * The recipients are read off the transfers that were just computed, so the
   * permission is structural rather than checked: a participant reaches this
   * list only by appearing in a debt the balances say the reader has. There is
   * no endpoint that answers "show me their IBAN".
   */
  const owed = view.currencies.flatMap((entry) =>
    [...entry.yours, ...entry.others]
      .filter((transfer) => transfer.fromIsSelf)
      .map((transfer) => transfer.toParticipantId),
  );
  const [payouts, addresses] = await Promise.all([
    listPayoutsOwed(access.groupId, owed),
    listPayoutAddressesOwed(access.groupId, owed),
  ]);

  /*
   * The amount each debt is for, which the payment code needs and the map of
   * methods does not carry. Taken from the same transfers the recipients were
   * read off, so the code can never name a figure the screen is not showing.
   */
  const debts = new Map(
    view.currencies.flatMap((entry) =>
      [...entry.yours, ...entry.others]
        .filter((transfer) => transfer.fromIsSelf)
        .map(
          (transfer) =>
            [
              transfer.toParticipantId,
              {
                minorUnits: transfer.amount.toString(),
                currency: transfer.currency,
                name: transfer.toName,
              },
            ] as const,
        ),
    ),
  );

  const payoutHints = [...payouts.entries()].flatMap(
    ([participantId, methods]) => {
      const top = methods[0];
      if (!top) return [];
      const debt = debts.get(participantId);

      /*
       * A code is only built for a bank transfer, and only when everything the
       * standard needs is present. A TWINT number is not something a banking app
       * scans, and a Swiss account with no address on file is a code that would
       * be refused — so both come back as no code at all rather than as one that
       * fails at the till.
       */
      const qr =
        top.method === "bank" && debt
          ? buildPaymentQr({
              iban: top.detail,
              creditorName: debt.name,
              address: addresses.get(participantId) ?? null,
              minorUnits: debt.minorUnits,
              currency: debt.currency,
              message: access.group.name,
            })
          : null;

      return [{ participantId, method: top.method, detail: top.detail, qr }];
    },
  );

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
