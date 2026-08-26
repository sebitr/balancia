import "server-only";
import type { Database } from "@/lib/db/client";
import type { SettleUpView } from "@/modules/settlements/settle-up";
import { listPayoutAddressesOwed, listPayoutsOwed } from "./service";
import type { PaymentQr, PaymentQrRefusal } from "./qr/payment-qr";
import { buildPaymentQr, explainMissingQr } from "./qr/payment-qr";

/**
 * How to pay each debt the reader has been told they owe.
 *
 * This was assembled inside the settle-up page, which was fine while the web
 * was the only thing that drew the screen. The native app draws it too, and a
 * payment code built twice is a payment code that can differ twice: one side
 * choosing the first method rather than the bank one, or filling in an amount
 * from a different read of the balances. So the assembly lives here and both
 * callers ask for the answer.
 *
 * The permission model is the interesting part, and it is structural rather
 * than checked. A recipient reaches this list only by appearing in a transfer
 * the group's own balances say the reader owes — there is no endpoint that
 * answers "show me their IBAN", and adding one would be the mistake.
 */

export interface PayoutHint {
  /** Whom the debt is owed to; the row is matched on this and the currency. */
  readonly participantId: string;
  readonly currency: string;
  /** Every method, in the owner's order. */
  readonly methods: readonly {
    readonly method: string;
    readonly detail: string;
  }[];
  readonly qr: PaymentQr | null;
  /** Why there is no code, when that is something the reader can act on. */
  readonly qrMissing: PaymentQrRefusal | null;
}

/**
 * The debts the reader owes, across every currency.
 *
 * Built from the transfers rather than from the recipients, because a payment
 * code is made of a debt and not of a person: in a group balancing in two
 * currencies you can owe the same person twice, and one hint per person would
 * put the same code — one amount, one currency — on both of those rows.
 */
export function debtsOf(view: SettleUpView) {
  return view.currencies.flatMap((entry) =>
    [...entry.yours, ...entry.others].filter((transfer) => transfer.fromIsSelf),
  );
}

export async function buildPayoutHints(
  groupId: string,
  groupName: string,
  view: SettleUpView,
  options: { db?: Database } = {},
): Promise<readonly PayoutHint[]> {
  const debts = debtsOf(view);
  if (debts.length === 0) return [];

  const owed = debts.map((transfer) => transfer.toParticipantId);
  const [payouts, addresses] = await Promise.all([
    listPayoutsOwed(groupId, owed, options),
    listPayoutAddressesOwed(groupId, owed, options),
  ]);

  return debts.flatMap((transfer) => {
    const methods = payouts.get(transfer.toParticipantId) ?? [];
    if (methods.length === 0) return [];

    /*
     * A code is only built for a bank transfer, and only when everything the
     * standard needs is present. A TWINT number is not something a banking app
     * scans, and a Swiss account with no address on file is a code that would
     * be refused — so both come back as no code at all rather than as one that
     * fails at the till.
     *
     * The bank entry is found by name rather than read off the top of the
     * list. The order is the owner's own preference, and somebody who would
     * rather be paid by TWINT still has an account a bank app can pay into.
     *
     * The amount comes from the transfer the row is showing, so the code can
     * never name a figure that is not on screen beside it.
     */
    const bank = methods.find((entry) => entry.method === "bank");
    const request = bank
      ? {
          iban: bank.detail,
          creditorName: transfer.toName,
          address: addresses.get(transfer.toParticipantId) ?? null,
          minorUnits: transfer.amount.toString(),
          currency: transfer.currency,
          message: groupName,
        }
      : null;

    const qr = request ? buildPaymentQr(request) : null;

    /*
     * And when there is none, why — but only for the reasons somebody can do
     * something about. `explainMissingQr` answers "none" for the rest, and
     * "none" stays silent: a sentence the reader can act on beats a blank
     * where they expected a code, and a sentence they cannot act on is worse
     * than the blank, because it costs them a read to find that out.
     */
    const missing = request && !qr ? explainMissingQr(request) : "none";

    return [
      {
        participantId: transfer.toParticipantId,
        currency: transfer.currency,
        methods: methods.map((entry) => ({
          method: entry.method,
          detail: entry.detail,
        })),
        qr,
        qrMissing: missing === "none" ? null : missing,
      },
    ];
  });
}
