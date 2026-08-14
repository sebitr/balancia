import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import {
  notificationGroupMutes,
  notificationPreferences,
  participants,
  pushSubscriptions,
  reminders,
} from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { activityActorFrom, recordActivity } from "@/modules/activity/service";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  dispatchNotifications,
  recordNotifications,
} from "@/modules/notifications/service";
import {
  REMIND_LOCK_HOURS,
  type RemindChannel,
  type RemindRecipient,
  type RemindResult,
} from "./types";

/**
 * Reminders: asking, once, for money you are owed.
 *
 * Four rules are enforced here rather than in the sheet, because a screen can
 * be bypassed and a service cannot:
 *
 *  1. Only debts *to the caller*. The recipient list is recomputed from the
 *     balances on every call, so a forged participant id reminds nobody.
 *  2. One reminder per person per 24 hours, read from the `reminders` table.
 *  3. A muted group is never pushed to. The reminder still goes out through
 *     the sender's share sheet, and the sheet says so before they send.
 *  4. It is logged. "Seb reminded Jonas" is visible to the group, so nudging
 *     is never something that happens quietly.
 */

/** A refusal the sheet can show verbatim. */
export class ReminderError extends Error {
  /** Translated by the Server Action funnel; see `lib/actions.ts`. */
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ReminderError";
    this.code = code;
  }
}

/** Whether the 24-hour limit is still running. Pure, so it can be tested. */
export function isLocked(
  lastRemindedAt: Date | null,
  now: Date = new Date(),
): boolean {
  if (!lastRemindedAt) return false;
  const elapsed = now.getTime() - lastRemindedAt.getTime();
  return elapsed < REMIND_LOCK_HOURS * 60 * 60 * 1000;
}

/**
 * Everyone who owes the reader, with the route their message would take.
 *
 * Read off the *simplified* debts: the question is who the reader would ask
 * for money, and simplification is what turns a web of small balances into
 * that shorter list.
 */
export async function listRemindRecipients(
  access: Pick<GroupAccess, "groupId" | "group" | "participantId">,
  options: { db?: Database; now?: Date } = {},
): Promise<RemindRecipient[]> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const self = access.participantId;
  if (!self) return [];

  const balances = await loadGroupBalances(access, { db });

  const debts = [...balances.suggestionsByCurrency.values()]
    .flat()
    .filter((suggestion) => suggestion.toParticipantId === self);
  if (debts.length === 0) return [];

  const debtorIds = [...new Set(debts.map((debt) => debt.fromParticipantId))];

  const [rows, sent] = await Promise.all([
    db
      .select({
        id: participants.id,
        displayName: participants.displayName,
        userId: participants.userId,
      })
      .from(participants)
      .where(inArray(participants.id, debtorIds)),
    db
      .select({
        toParticipantId: reminders.toParticipantId,
        sentAt: reminders.sentAt,
      })
      .from(reminders)
      .where(
        and(
          eq(reminders.groupId, access.groupId),
          eq(reminders.fromParticipantId, self),
          inArray(reminders.toParticipantId, debtorIds),
        ),
      )
      .orderBy(desc(reminders.sentAt)),
  ]);

  const userIds = rows
    .map((row) => row.userId)
    .filter((id): id is string => id !== null);

  // Who could actually receive a push: an account, a subscribed device,
  // reminders left on, and this group not silenced. Any one of them missing
  // routes the message through the sender instead.
  const [subscribed, preferences, muted] = await Promise.all([
    userIds.length
      ? db
          .selectDistinct({ userId: pushSubscriptions.userId })
          .from(pushSubscriptions)
          .where(inArray(pushSubscriptions.userId, userIds))
      : Promise.resolve([]),
    userIds.length
      ? db
          .select({
            userId: notificationPreferences.userId,
            remindersEnabled: notificationPreferences.remindersEnabled,
          })
          .from(notificationPreferences)
          .where(inArray(notificationPreferences.userId, userIds))
      : Promise.resolve([]),
    userIds.length
      ? db
          .select({ userId: notificationGroupMutes.userId })
          .from(notificationGroupMutes)
          .where(
            and(
              inArray(notificationGroupMutes.userId, userIds),
              eq(notificationGroupMutes.groupId, access.groupId),
            ),
          )
      : Promise.resolve([]),
  ]);

  const hasDevice = new Set(subscribed.map((row) => row.userId));
  const mutedUsers = new Set(muted.map((row) => row.userId));
  // A missing preferences row means every category is on.
  const remindersOff = new Set(
    preferences.filter((row) => !row.remindersEnabled).map((row) => row.userId),
  );

  const lastSent = new Map<string, Date>();
  for (const row of sent) {
    if (!lastSent.has(row.toParticipantId)) {
      lastSent.set(row.toParticipantId, row.sentAt);
    }
  }
  const nameOf = new Map(rows.map((row) => [row.id, row]));

  return debts
    .map((debt) => {
      const person = nameOf.get(debt.fromParticipantId);
      const userId = person?.userId ?? null;
      const isMuted = userId !== null && mutedUsers.has(userId);
      const channel: RemindChannel =
        userId !== null &&
        hasDevice.has(userId) &&
        !remindersOff.has(userId) &&
        !isMuted
          ? "push"
          : "share";
      const remindedAt = lastSent.get(debt.fromParticipantId) ?? null;

      return {
        participantId: debt.fromParticipantId,
        name: person?.displayName ?? "",
        amount: debt.amount.toString(),
        currency: debt.currency,
        channel,
        lastRemindedAt: remindedAt?.toISOString() ?? null,
        locked: isLocked(remindedAt, now),
        muted: isMuted,
      } satisfies RemindRecipient;
    })
    .sort((a, b) => {
      const left = BigInt(a.amount);
      const right = BigInt(b.amount);
      return right > left ? 1 : right < left ? -1 : 0;
    });
}

export interface SendReminderInput {
  readonly toParticipantId: string;
  /** The finished message, as the sender composed or edited it. */
  readonly message: string;
  readonly logToActivity: boolean;
}

/**
 * Records one reminder and, where it can, delivers it.
 *
 * The recipient list is rebuilt here rather than trusted from the request:
 * everything the sheet knows is re-derived, so the only reminders that can be
 * written are ones the balances actually justify.
 */
export async function sendReminder(
  access: GroupAccess,
  input: SendReminderInput,
  options: { db?: Database; now?: Date } = {},
): Promise<RemindResult> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const message = input.message.trim();
  if (message.length === 0) {
    throw new ReminderError(
      "reminderEmpty",
      "A reminder needs something to say.",
    );
  }

  const self = access.participantId;
  if (!self) {
    throw new ReminderError(
      "reminderNotOwed",
      "Only someone who is owed money can send a reminder.",
    );
  }

  const recipients = await listRemindRecipients(access, { db, now });
  const recipient = recipients.find(
    (candidate) => candidate.participantId === input.toParticipantId,
  );
  if (!recipient) {
    throw new ReminderError(
      "reminderNotOwed",
      "That person does not owe you anything in this group.",
    );
  }
  if (recipient.locked) {
    throw new ReminderError(
      "reminderTooSoon",
      "That person was reminded in the last 24 hours.",
    );
  }

  const actor = activityActorFrom(access);

  const notificationIds = await db.transaction(async (tx) => {
    await tx.insert(reminders).values({
      groupId: access.groupId,
      fromParticipantId: self,
      toParticipantId: recipient.participantId,
      channel: recipient.channel,
      amount: BigInt(recipient.amount),
      currency: recipient.currency,
      sentAt: now,
    });

    if (input.logToActivity) {
      await recordActivity(tx, {
        groupId: access.groupId,
        action: "reminder.sent",
        entityType: "participant",
        entityId: recipient.participantId,
        // The name, not the wording: the group learns that a nudge went out,
        // never what it said.
        metadata: { recipient: recipient.name },
        ...actor,
      });
    }

    if (recipient.channel !== "push") return [];

    return recordNotifications(tx, {
      type: "reminder.received",
      groupId: access.groupId,
      entityType: "participant",
      entityId: recipient.participantId,
      actorLabel: actor.actorLabel,
      participantIds: [recipient.participantId],
      payload: {
        kind: "reminder",
        groupName: access.group.name,
        amount: recipient.amount,
        currency: recipient.currency,
        creditorName: actor.actorLabel,
        message,
      },
    });
  });

  await dispatchNotifications(notificationIds);

  return {
    channel: recipient.channel,
    shareText: recipient.channel === "share" ? message : null,
    recipientName: recipient.name,
  };
}
