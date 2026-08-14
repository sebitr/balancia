import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { expensePayers, expenseShares, participants } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";
import { recordNotifications } from "./service";
import type { NotificationType } from "./types";

/**
 * The bridge between domain services and the notification module.
 *
 * Services call these instead of assembling drafts by hand, so the rules that
 * decide *who hears about what* live in one place: the audience for a money
 * change is the people whose money it is, and never the person who made it.
 *
 * Every function takes the caller's transaction and returns the ids it wrote.
 * The caller pushes them with `dispatchNotifications` once that transaction
 * has committed — never inside it.
 */

/** Who the actor is, for "do not notify me about my own doing". */
function actingUserId(access: GroupAccess): string | null {
  return access.actor.kind === "user" ? access.actor.userId : null;
}

function actorLabel(access: GroupAccess): string {
  return access.actor.kind === "guest"
    ? access.actor.displayName
    : access.actor.name;
}

/** Everyone who paid for, or owes a share of, an expense. */
export async function participantsOfExpense(
  tx: Database,
  expenseId: string,
): Promise<string[]> {
  const payers = await tx
    .select({ participantId: expensePayers.participantId })
    .from(expensePayers)
    .where(eq(expensePayers.expenseId, expenseId));
  const shares = await tx
    .select({ participantId: expenseShares.participantId })
    .from(expenseShares)
    .where(eq(expenseShares.expenseId, expenseId));

  return [
    ...new Set([
      ...payers.map((row) => row.participantId),
      ...shares.map((row) => row.participantId),
    ]),
  ];
}

export interface ExpenseNotificationInput {
  readonly type: Extract<
    NotificationType,
    "expense.created" | "expense.updated" | "expense.deleted"
  >;
  readonly expenseId: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  /** Payers and share-holders. For an edit, the old and new sets together. */
  readonly participantIds: readonly string[];
}

export async function recordExpenseNotification(
  tx: Database,
  access: GroupAccess,
  input: ExpenseNotificationInput,
): Promise<string[]> {
  return recordNotifications(tx, {
    type: input.type,
    groupId: access.groupId,
    entityType: "expense",
    entityId: input.expenseId,
    actorLabel: actorLabel(access),
    participantIds: input.participantIds,
    excludeUserId: actingUserId(access),
    payload: {
      kind: "expense",
      groupName: access.group.name,
      description: input.description,
      amount: input.amount.toString(),
      currency: input.currency,
    },
  });
}

export interface SettlementNotificationInput {
  readonly type: Extract<
    NotificationType,
    "settlement.created" | "settlement.updated" | "settlement.deleted"
  >;
  readonly settlementId: string;
  readonly fromParticipantId: string;
  readonly toParticipantId: string;
  readonly amount: bigint;
  readonly currency: string;
}

/**
 * A payment reads differently depending on which end of it you are, so it
 * produces one draft per side rather than one neutrally-worded draft for both.
 */
export async function recordSettlementNotification(
  tx: Database,
  access: GroupAccess,
  input: SettlementNotificationInput,
): Promise<string[]> {
  const names = await tx
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, access.groupId),
        inArray(participants.id, [
          input.fromParticipantId,
          input.toParticipantId,
        ]),
      ),
    );
  const nameOf = new Map(names.map((row) => [row.id, row.displayName]));

  const sides = [
    {
      // The recipient of the money.
      participantId: input.toParticipantId,
      direction: "incoming" as const,
      counterpartName: nameOf.get(input.fromParticipantId) ?? "",
    },
    {
      // The one who paid.
      participantId: input.fromParticipantId,
      direction: "outgoing" as const,
      counterpartName: nameOf.get(input.toParticipantId) ?? "",
    },
  ];

  const created: string[] = [];
  for (const side of sides) {
    const ids = await recordNotifications(tx, {
      type: input.type,
      groupId: access.groupId,
      entityType: "settlement",
      entityId: input.settlementId,
      actorLabel: actorLabel(access),
      participantIds: [side.participantId],
      excludeUserId: actingUserId(access),
      payload: {
        kind: "settlement",
        groupName: access.group.name,
        amount: input.amount.toString(),
        currency: input.currency,
        direction: side.direction,
        counterpartName: side.counterpartName,
      },
    });
    created.push(...ids);
  }
  return created;
}

export interface RecurringNotificationInput {
  readonly groupId: string;
  readonly groupName: string;
  readonly expenseId: string;
  readonly description: string;
  readonly amount: bigint;
  readonly currency: string;
  readonly participantIds: readonly string[];
}

/**
 * A generated recurring expense has no actor: the schedule did it, and there
 * is nobody to leave out of the audience.
 */
export async function recordRecurringNotification(
  tx: Database,
  input: RecurringNotificationInput,
): Promise<string[]> {
  return recordNotifications(tx, {
    type: "recurring.generated",
    groupId: input.groupId,
    entityType: "expense",
    entityId: input.expenseId,
    actorLabel: null,
    participantIds: input.participantIds,
    payload: {
      kind: "recurring",
      groupName: input.groupName,
      description: input.description,
      amount: input.amount.toString(),
      currency: input.currency,
    },
  });
}

export interface ImportNotificationInput {
  readonly groupId: string;
  readonly groupName: string;
  readonly importRunId: string;
  /** The person who started it — the only one waiting for the answer. */
  readonly userId: string;
  readonly imported: number;
  readonly skipped: number;
  readonly failed: number;
}

/**
 * Imports notify their initiator, not the group.
 *
 * The work is queued and finishes minutes later in the worker, so the person
 * who started it is the one with an unanswered question. Everyone else finds
 * out through the expenses the import created.
 */
export async function recordImportNotification(
  tx: Database,
  input: ImportNotificationInput,
): Promise<string[]> {
  return recordNotifications(tx, {
    type: "import.completed",
    groupId: input.groupId,
    entityType: "import",
    entityId: input.importRunId,
    actorLabel: null,
    userIds: [input.userId],
    payload: {
      kind: "import",
      groupName: input.groupName,
      imported: input.imported,
      skipped: input.skipped,
      failed: input.failed,
    },
  });
}
