import type { notifications } from "@/lib/db/schema";

/**
 * What a notification carries, and what it deliberately does not.
 *
 * A payload holds the *facts* needed to write the line — an amount, a
 * description, a group name — never the finished sentence. The reader can
 * change language between the moment something happened and the moment they
 * read about it, and a push message has to be written in the recipient's
 * language rather than in the language of whoever caused it.
 *
 * Money travels as minor units in a string, like everywhere else in Balancia:
 * a payload is JSON, and JSON numbers lose precision.
 */

export type NotificationType = (typeof notifications.$inferInsert)["type"];
export type NotificationCategory =
  (typeof notifications.$inferInsert)["category"];

/** Which switch in the profile governs which events. */
export const CATEGORY_BY_TYPE: Record<NotificationType, NotificationCategory> =
  {
    "expense.created": "expenses",
    "expense.updated": "expenses",
    "expense.deleted": "expenses",
    "settlement.created": "settlements",
    "settlement.updated": "settlements",
    "settlement.deleted": "settlements",
    "recurring.generated": "recurring",
    "import.completed": "imports",
    "reminder.received": "reminders",
  };

interface BasePayload {
  /** Captured at write time, so the line still reads correctly after a rename. */
  readonly groupName: string;
}

export interface ExpensePayload extends BasePayload {
  readonly kind: "expense";
  readonly description: string;
  /** Minor units, as a string. */
  readonly amount: string;
  readonly currency: string;
}

/**
 * Settlements are written from the reader's point of view, so a payment
 * produces one draft per side rather than one draft with a neutral wording:
 * "Sam paid you €20" and "Sam recorded your payment of €20" are different
 * sentences about the same row.
 */
export interface SettlementPayload extends BasePayload {
  readonly kind: "settlement";
  readonly amount: string;
  readonly currency: string;
  /** "incoming" — the reader received it. "outgoing" — the reader paid. */
  readonly direction: "incoming" | "outgoing";
  /** The other person's display name. */
  readonly counterpartName: string;
}

export interface RecurringPayload extends BasePayload {
  readonly kind: "recurring";
  readonly description: string;
  readonly amount: string;
  readonly currency: string;
}

export interface ImportPayload extends BasePayload {
  readonly kind: "import";
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Someone asking for money they are owed.
 *
 * This is the one payload that carries finished text, and deliberately: the
 * sender chose that wording from the message library, or wrote it themselves.
 * Translating it would put words in their mouth, so `message` is treated like
 * an expense description — authored content, reproduced as written — while the
 * line under it is still rendered in the reader's own language from the facts.
 */
export interface ReminderPayload extends BasePayload {
  readonly kind: "reminder";
  /**
   * What the reader owes, one entry per currency.
   *
   * A list rather than a single amount because a separate-currency group can
   * leave the same two people owing in two currencies, and one reminder asks
   * about all of them.
   */
  readonly debts: readonly {
    /** Minor units, as a string. */
    readonly amount: string;
    readonly currency: string;
  }[];
  /** The person owed. The message addresses the debt, never the reader. */
  readonly creditorName: string;
  readonly message: string;
}

/**
 * A reminder payload as it comes *back* out of the table.
 *
 * Reminders written before debts were grouped per person carry a single
 * `amount` and `currency` instead of `debts`. Those rows are still in people's
 * inboxes, so the renderer reads either shape — a notification already
 * delivered should not change what it says, or stop saying it.
 */
export interface StoredReminderPayload {
  readonly debts?: ReminderPayload["debts"];
  readonly amount?: string;
  readonly currency?: string;
}

export type NotificationPayload =
  | ExpensePayload
  | SettlementPayload
  | RecurringPayload
  | ImportPayload
  | ReminderPayload;

/** One notification as the inbox and the renderer see it. */
export interface NotificationEntry {
  readonly id: string;
  readonly groupId: string;
  readonly type: NotificationType;
  readonly category: NotificationCategory;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorLabel: string | null;
  readonly payload: NotificationPayload;
  readonly createdAt: Date;
  readonly readAt: Date | null;
}

/** The per-category switches, as the profile page shows them. */
export interface NotificationPreferences {
  readonly expenses: boolean;
  readonly settlements: boolean;
  readonly recurring: boolean;
  readonly imports: boolean;
  readonly reminders: boolean;
}

export const DEFAULT_PREFERENCES: NotificationPreferences = {
  expenses: true,
  settlements: true,
  recurring: true,
  imports: true,
  reminders: true,
};
