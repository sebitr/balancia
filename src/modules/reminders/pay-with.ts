import { payoutDeepLink } from "@/modules/payouts/deep-links";
import { payoutFieldFor } from "@/modules/payouts/fields";
import {
  buildPaymentQr,
  type PaymentQrStandard,
} from "@/modules/payouts/qr/payment-qr";
import type { SwissCreditorAddress } from "@/modules/payouts/qr/swiss";
import type { RemindDebt, RemindPayOption } from "./types";

/**
 * The way to pay, put in the same bubble as the amount.
 *
 * A reminder that arrives as "€148.00" and a reminder that arrives as
 * "€148.00, and here is the Girocode" are different messages, and only the
 * second one gets paid that evening. Everything needed to build the second was
 * already here — six QR standards and seven deep links, in `modules/payouts` —
 * and none of it had ever left the settle-up screen, which is the screen the
 * person who owes you is precisely not looking at.
 *
 * So this takes the same catalogue and asks a narrower question: **what
 * survives being pasted into a chat app.** That is a shorter list than the
 * settle screen's, and the difference is the whole of this file.
 *
 * ## Three shapes, in the order they are preferred
 *
 *  1. **A link.** Tappable in the bubble, opens the payment app on the
 *     payment. Only the https ones: `upi://` is the single custom scheme here,
 *     and a message can end up on a desktop where it resolves to nothing —
 *     which is the dead button the settle screen gates behind `useAppLinksWork`
 *     and a message has no way to gate at all. Its intent travels as a picture
 *     instead, which is the same answer that screen reaches for.
 *  2. **A pasted code.** Pix calls it *Copia e Cola* and it is how a great
 *     many Brazilians actually pay; SPAYD and the Polish code are the same
 *     kind of artefact. The two SEPA payloads are not — eleven and thirty-odd
 *     newline-separated lines — and neither goes anywhere useful in a paste
 *     field, so for those the line is the IBAN and the code is the picture.
 *  3. **The detail itself.** An IBAN, a handle, a number. It is what people
 *     type into a chat by hand today, which is the practice this is replacing
 *     rather than the fallback it looks like.
 *
 * The scannable code rides along as an attachment where the sender's device
 * will carry files, and is the point of the exercise for the two SEPA
 * standards: a Girocode is not text and never was.
 *
 * ## Nothing here names a figure that is not the debt
 *
 * A code and several of the links carry the amount, and the amount they carry
 * comes from the debt this reminder is about. Where the recipient owes in more
 * than one currency there *is* no such figure — a separate-currency group
 * balances each on its own and no rate is applied anywhere — so every
 * amount-carrying artefact is dropped for that recipient and what is left names
 * only the account. That is the same refusal `deep-links.ts` and
 * `qr/payment-qr.ts` already make about a currency a standard cannot express,
 * for the same reason: a payment instruction correct to two decimal places and
 * wrong by a third is the worst thing this feature could do.
 */

export interface PayWithMethod {
  readonly method: string;
  readonly detail: string;
}

export interface PayWithInput {
  /** The reader's own methods, in the order they ranked them. */
  readonly methods: readonly PayWithMethod[];
  /** Their postal address, for the one standard that requires one. */
  readonly address: SwissCreditorAddress | null;
  /** The reader — the person being paid. */
  readonly creditorName: string;
  /** What the payment is for, where a scheme carries a reference. */
  readonly groupName: string;
  /** What this one recipient owes, one entry per currency. */
  readonly debts: readonly RemindDebt[];
}

/**
 * The standards whose payload is text a person can paste.
 *
 * The same four the settle screen offers a Copy button for, and for the same
 * reason: everything else in the table is a picture pretending to be a string.
 */
const PASTEABLE: ReadonlySet<PaymentQrStandard> = new Set([
  "pix",
  "spayd",
  "zbp",
  "swish",
]);

export function payWithOptions(input: PayWithInput): RemindPayOption[] {
  // One currency or nothing: see the note above on why two amounts leave no
  // figure any instruction may claim.
  const debt = input.debts.length === 1 ? input.debts[0] : null;

  return input.methods.flatMap((entry) => {
    const detail = entry.detail.trim();
    // Cash and cheques carry nothing to send, and a method with an empty
    // detail is a row somebody started and never finished.
    if (detail === "" || payoutFieldFor(entry.method) === "none") return [];

    const option = debt
      ? forOneDebt(entry.method, detail, debt, input)
      : withoutAnAmount(entry.method, detail);
    return option ? [option] : [];
  });
}

/**
 * The full instruction: this account, this sum, this reference.
 */
function forOneDebt(
  method: string,
  detail: string,
  debt: RemindDebt,
  input: PayWithInput,
): RemindPayOption | null {
  const qr = buildPaymentQr({
    method,
    detail,
    creditorName: input.creditorName,
    address: input.address,
    minorUnits: debt.amount,
    currency: debt.currency,
    message: input.groupName,
  });

  const app = payoutDeepLink({
    method,
    detail,
    minorUnits: debt.amount,
    currency: debt.currency,
    note: input.groupName,
    payeeName: input.creditorName,
  });

  /*
   * A scheme's own code beats a link turned into one. Where a method has both
   * — nothing in the catalogue does today, but the two tables are independent
   * and one day something will — the code is what the payer's bank designed
   * its scanner around, and two pictures in one bubble is a choice nobody
   * should have to make.
   */
  const code = qr
    ? { standard: qr.standard, payload: qr.payload }
    : app && app.kind === "scheme"
      ? { standard: null, payload: app.href }
      : null;

  if (app && app.kind === "universal") {
    return { method, kind: "link", text: app.href, code };
  }
  if (qr && PASTEABLE.has(qr.standard)) {
    return { method, kind: "code", text: qr.payload, code };
  }
  return { method, kind: detailKind(method), text: detail, code };
}

/**
 * What is left when there is no one figure to name: the account, and nothing
 * that could claim to know what is owed against it.
 *
 * Built from the detail rather than from a second pass through the link table,
 * because every link that is worth having without an amount *is* the detail —
 * a Revtag is `revolut.me/<revtag>`, and PayPal's stored detail is already the
 * URL its owner typed.
 */
function withoutAnAmount(method: string, detail: string): RemindPayOption {
  return { method, kind: detailKind(method), text: detail, code: null };
}

/**
 * Whether a bare detail is already a URL.
 *
 * PayPal is the one method whose field asks for a link, so its detail lands in
 * the message as something tappable rather than as something to copy, and the
 * chip beside the draft should say which it is.
 */
function detailKind(method: string) {
  return payoutFieldFor(method) === "link"
    ? ("link" as const)
    : ("detail" as const);
}
