import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettleUpScreen } from "@/components/settlements/settle-up-screen";
import { requireGroupAccess } from "@/lib/actions";
import { listParticipants } from "@/modules/groups/service";
import { listRemindRecipients } from "@/modules/reminders/service";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import { listPayoutsOwed } from "@/modules/payouts/service";

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
  const payouts = await listPayoutsOwed(access.groupId, owed);
  const payoutHints = [...payouts.entries()].flatMap(
    ([participantId, methods]) =>
      methods[0]
        ? [
            {
              participantId,
              method: methods[0].method,
              detail: methods[0].detail,
            },
          ]
        : [],
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
