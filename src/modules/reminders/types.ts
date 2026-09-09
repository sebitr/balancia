import type { PaymentQrStandard } from "@/modules/payouts/qr/payment-qr";

/**
 * Who can be reminded, and how the message would reach them.
 *
 * Only people who owe the reader ever appear. Reminding on someone else's
 * behalf is not a feature with a missing button — it is deliberately absent,
 * because a debt is between two people and a third one asking about it is a
 * different thing entirely.
 */

/**
 * `push` means Balancia can deliver it: the recipient has an account, a device
 * subscribed to notifications, reminders switched on and this group unmuted.
 * `share` means it leaves through the sender's own share sheet — a guest with
 * no account, someone who never enabled notifications, or someone who silenced
 * this group. The distinction is shown before sending, never discovered after.
 */
export type RemindChannel = "push" | "share";

/**
 * One currency's worth of what somebody owes.
 *
 * A group that spends in two currencies keeps two sets of balances, and they
 * are never added together — so what one person owes is a list of amounts, not
 * a number.
 */
export interface RemindDebt {
  /** Minor units owed to the reader, always positive. */
  readonly amount: string;
  readonly currency: string;
}

/**
 * A payment instruction the reader can put in a chat message.
 *
 * The settle-up screen can afford a code on screen and a button to press; a
 * reminder has one bubble and whatever fits in it. So a way to pay earns a
 * place here only if it survives being pasted into WhatsApp — a URL, a
 * one-line payload, or the detail itself — with the scannable code riding
 * along as an attached picture where the platform will carry files.
 */
export type RemindPayKind = "link" | "code" | "detail";

/** The scannable half, when this method has one for this debt. */
export interface RemindPayCode {
  /**
   * Null when the payload is an ordinary link handed to a camera rather than a
   * scheme's own code — a `upi://` intent is the only one of those.
   */
  readonly standard: PaymentQrStandard | null;
  readonly payload: string;
}

export interface RemindPayOption {
  /** The payout method it came from, for the label the sender reads. */
  readonly method: string;
  readonly kind: RemindPayKind;
  /** The one line that goes into the message. */
  readonly text: string;
  /** Attached as an image where the sender's device will carry one. */
  readonly code: RemindPayCode | null;
}

export interface RemindRecipient {
  readonly participantId: string;
  readonly name: string;
  /**
   * What they owe, one entry per currency, largest first — never empty.
   *
   * A person is one recipient however many currencies they owe in: they are
   * asked once, they are counted once, and the one reminder names every amount.
   */
  readonly debts: readonly RemindDebt[];
  readonly channel: RemindChannel;
  /** ISO instant of the last reminder along this debt, if any. */
  readonly lastRemindedAt: string | null;
  /** True while the 24-hour limit is still running. */
  readonly locked: boolean;
  /** They silenced this group; the sheet says so rather than pushing anyway. */
  readonly muted: boolean;
  /**
   * How the reader could be paid this particular debt, in their own order.
   *
   * Per recipient rather than per sender, because a payment instruction is
   * made of a debt and not of a person: the amount written into a code is
   * *this* debt's, and somebody owing in two currencies has no single figure
   * to write — so their options are the ones that name no amount at all.
   *
   * Empty is the ordinary answer for anybody who has never said how they want
   * to be paid back, and for a guest, who has no account to hang it on.
   */
  readonly payWith: readonly RemindPayOption[];
}

/** What the caller gets back once a reminder has been recorded. */
export interface RemindResult {
  readonly channel: RemindChannel;
  /**
   * The finished message, returned only for `share`: the sender's own device
   * is the one that will deliver it, so it needs the text back.
   */
  readonly shareText: string | null;
  readonly recipientName: string;
}

/** How long a person is left alone after being reminded. */
export const REMIND_LOCK_HOURS = 24;

/**
 * The longest a reminder may be.
 *
 * A draft is one sentence and a link; this is room for somebody to rewrite it
 * into a short paragraph and no more. It is a bound on what reaches the
 * `notifications` payload column rather than a rule about writing — the text
 * is stored per recipient, and a field with no ceiling is a field somebody
 * eventually posts a megabyte into.
 *
 * This is the whole message, which is not what the sheet's textarea holds:
 * the link is appended after the writer is done with it. `REMIND_BODY_MAX_LENGTH`
 * is the part they type, and the gap between the two is the room the tail
 * needs — now a way to pay as well as the group link, and a Pix payload is a
 * hundred and thirty characters of it.
 */
export const REMIND_MESSAGE_MAX_LENGTH = 1200;

/**
 * The longest the *typed* part may be — what the textarea caps.
 *
 * Four hundred characters short of the message limit, which is more than an
 * origin plus `/groups/<uuid>` and the longest payment line either need.
 * Capping the box rather than only the action is what stops the limit being
 * discovered as a refusal after the writing is done.
 */
export const REMIND_BODY_MAX_LENGTH = 800;
