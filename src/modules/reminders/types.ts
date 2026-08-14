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

export interface RemindRecipient {
  readonly participantId: string;
  readonly name: string;
  /** Minor units owed to the reader, always positive. */
  readonly amount: string;
  readonly currency: string;
  readonly channel: RemindChannel;
  /** ISO instant of the last reminder along this debt, if any. */
  readonly lastRemindedAt: string | null;
  /** True while the 24-hour limit is still running. */
  readonly locked: boolean;
  /** They silenced this group; the sheet says so rather than pushing anyway. */
  readonly muted: boolean;
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
