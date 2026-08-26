import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SettleUpScreen } from "@/components/settlements/settle-up-screen";
import { requireGroupAccess } from "@/lib/actions";
import { listParticipants } from "@/modules/groups/service";
import { listRemindRecipients } from "@/modules/reminders/service";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import { buildPayoutHints } from "@/modules/payouts/hints";

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
   * How to pay each debt, assembled where the native app's settle-up route
   * assembles it too — a payment code built twice is one that can differ
   * twice.
   */
  const payoutHints = await buildPayoutHints(
    access.groupId,
    access.group.name,
    view,
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
