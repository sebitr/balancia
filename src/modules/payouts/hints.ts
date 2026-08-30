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

/** One way of being paid, with whatever code that particular scheme has. */
export interface PayoutHintMethod {
  readonly method: string;
  readonly detail: string;
  /** This scheme's own payment code, when one can be built for this debt. */
  readonly qr: PaymentQr | null;
  /** Why there is none, when the reader can act on the reason. */
  readonly qrMissing: PaymentQrRefusal | null;
}

export interface PayoutHint {
  /** Whom the debt is owed to; the row is matched on this and the currency. */
  readonly participantId: string;
  readonly currency: string;
  /** Every method, in the owner's order. */
  readonly methods: readonly PayoutHintMethod[];
  /**
   * The leading code, which is the one a screen shows before anybody chooses.
   *
   * Kept beside the per-method codes rather than removed: it is part of the
   * settle-up response the native client already reads, and a field that
   * disappears from a JSON contract breaks a shipped app rather than a build.
   * It is derived, never computed separately — whichever method below is the
   * first to carry a code, so the two can never disagree.
   */
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
     * A code is built for every method that has one, rather than for the bank
     * entry alone.
     *
     * It used to be the bank entry alone, on the reasoning that a payment code
     * is a thing banking apps scan. That was true of the two standards this
     * knew about and is not true of the catalogue: a Pix key and a Swedish
     * mobile number each have a code of their own that a third party can
     * build, and offering those methods while producing nothing but a string
     * to retype was the gap. `buildPaymentQr` decides per method and answers
     * null for the many that genuinely have nothing — a TWINT number is still
     * not something anybody scans.
     *
     * The amount comes from the transfer the row is showing, so no code can
     * ever name a figure that is not on screen beside it.
     */
    const address = addresses.get(transfer.toParticipantId) ?? null;

    const built = methods.map((entry) => {
      const request = {
        method: entry.method,
        detail: entry.detail,
        creditorName: transfer.toName,
        address,
        minorUnits: transfer.amount.toString(),
        currency: transfer.currency,
        message: groupName,
      };

      const qr = buildPaymentQr(request);

      /*
       * And when there is none, why — but only for the reasons somebody can do
       * something about. `explainMissingQr` answers "none" for the rest, and
       * "none" stays silent: a sentence the reader can act on beats a blank
       * where they expected a code, and a sentence they cannot act on is worse
       * than the blank, because it costs them a read to find that out.
       */
      const missing = qr ? "none" : explainMissingQr(request);

      return {
        method: entry.method,
        detail: entry.detail,
        qr,
        qrMissing: missing === "none" ? null : missing,
      };
    });

    // Derived, so the legacy pair can never contradict the list it came from.
    // A reason is only worth leading with when no method produced a code at
    // all; otherwise the screen has something better to show than an excuse.
    const leading = built.find((entry) => entry.qr !== null);
    const excuse = leading ? null : built.find((entry) => entry.qrMissing);

    return [
      {
        participantId: transfer.toParticipantId,
        currency: transfer.currency,
        methods: built,
        qr: leading?.qr ?? null,
        qrMissing: excuse?.qrMissing ?? null,
      },
    ];
  });
}
