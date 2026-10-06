import "server-only";
import { and, desc, eq, inArray, isNotNull, or } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  expenses,
  participants,
  recurringExpenses,
  settlements,
} from "@/lib/db/schema";
import type {
  GroupAccess,
  GroupPermissions,
} from "@/lib/security/authorization";

/**
 * Append-only activity history.
 *
 * `recordActivity` always takes an explicit transaction handle: an activity
 * event and the financial change it describes must commit together, so a
 * caller cannot accidentally write one without the other.
 */

export type ActivityAction = (typeof activityEvents.$inferInsert)["action"];

/** Structured context for an event. Must never carry secrets. */
export type ActivityMetadata = Record<string, unknown>;

const FORBIDDEN_METADATA_KEYS = new Set([
  "password",
  "token",
  "rawtoken",
  "tokenhash",
  "secret",
  "sessiontoken",
  "invitationtoken",
  "cookie",
  "authorization",
  "filecontent",
  "content",
]);

/**
 * Guards against a careless caller putting a token in the log. Activity rows
 * are long-lived and widely readable inside a group, so this is a hard error
 * rather than a filtered field.
 */
function assertSafeMetadata(metadata: ActivityMetadata | undefined): void {
  if (!metadata) return;
  const walk = (value: unknown, path: string[]): void => {
    if (value === null || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, [...path, String(index)]));
      return;
    }
    for (const [key, nested] of Object.entries(value)) {
      if (FORBIDDEN_METADATA_KEYS.has(key.toLowerCase())) {
        throw new Error(
          `Activity metadata must not contain "${[...path, key].join(".")}" — it may hold a secret.`,
        );
      }
      walk(nested, [...path, key]);
    }
  };
  walk(metadata, []);
}

export interface RecordActivityInput {
  readonly groupId: string;
  readonly action: ActivityAction;
  readonly entityType: string;
  readonly entityId?: string | null;
  readonly metadata?: ActivityMetadata;
  readonly actorType: "user" | "guest" | "system";
  readonly actorUserId?: string | null;
  readonly actorParticipantId?: string | null;
  readonly actorLabel?: string | null;
}

/**
 * Writes one activity event. `tx` is required — pass the same transaction the
 * financial write uses.
 */
export async function recordActivity(
  tx: Database,
  input: RecordActivityInput,
): Promise<void> {
  assertSafeMetadata(input.metadata);
  await tx.insert(activityEvents).values({
    groupId: input.groupId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    metadata: input.metadata ?? null,
    actorType: input.actorType,
    actorUserId: input.actorUserId ?? null,
    actorParticipantId: input.actorParticipantId ?? null,
    actorLabel: input.actorLabel ?? null,
  });
}

/** Derives the actor fields of an activity event from an access context. */
export function activityActorFrom(access: GroupAccess): {
  actorType: "user" | "guest";
  actorUserId: string | null;
  actorParticipantId: string | null;
  actorLabel: string;
} {
  if (access.actor.kind === "guest") {
    return {
      actorType: "guest",
      actorUserId: null,
      actorParticipantId: access.actor.participantId,
      actorLabel: access.actor.displayName,
    };
  }
  return {
    actorType: "user",
    actorUserId: access.actor.userId,
    actorParticipantId: access.participantId,
    actorLabel: access.actor.name,
  };
}

export interface ActivityEntry {
  readonly id: string;
  readonly action: ActivityAction;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly metadata: ActivityMetadata | null;
  readonly actorLabel: string | null;
  readonly actorType: "user" | "guest" | "system";
  /**
   * The actor's own row in the group, when they had one. Read for one thing:
   * a removal whose actor is the person removed is somebody leaving, and is
   * told that way. Null for the system, and once that row is gone.
   */
  readonly actorParticipantId: string | null;
  readonly createdAt: Date;
}

/** Recent activity for a group. Always called with an authorized group ID. */
export async function listGroupActivity(
  groupId: string,
  options: { limit?: number; db?: Database } = {},
): Promise<ActivityEntry[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: activityEvents.id,
      action: activityEvents.action,
      entityType: activityEvents.entityType,
      entityId: activityEvents.entityId,
      metadata: activityEvents.metadata,
      actorLabel: activityEvents.actorLabel,
      actorType: activityEvents.actorType,
      actorParticipantId: activityEvents.actorParticipantId,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(eq(activityEvents.groupId, groupId))
    .orderBy(desc(activityEvents.createdAt))
    .limit(options.limit ?? 25);

  return rows.map((row) => ({
    ...row,
    metadata: (row.metadata as ActivityMetadata | null) ?? null,
  }));
}

/**
 * The deletions the feed can take back, and what each one needs.
 *
 * Every one of these has had a restore since it had a delete — the one the
 * Undo toast calls. The permission is the one that restore checks for itself,
 * named again here only so that the screen never offers a button the action
 * behind it would refuse.
 *
 * A person taken out of the group is one of them. Removal is soft, like a
 * deletion, and its toast is the same eight seconds; missing it cost more than
 * a missing expense, because a removed person drops out of every picker and
 * their guest link stops working. Putting them back is the owner's alone, as
 * removing them is, so a guest or a member sees the line and no button.
 */
const RESTORABLE = {
  "expense.deleted": { kind: "expense", permission: "editAnyExpense" },
  "settlement.deleted": { kind: "settlement", permission: "addSettlement" },
  "recurring.deleted": {
    kind: "recurring_expense",
    permission: "manageRecurring",
  },
  "participant.removed": {
    kind: "participant",
    permission: "removeParticipants",
  },
} as const satisfies Partial<
  Record<ActivityAction, { kind: string; permission: keyof GroupPermissions }>
>;

type RestoreRule = (typeof RESTORABLE)[keyof typeof RESTORABLE];

/** What a deletion the feed can put back was a deletion of. */
export type RestorableKind = RestoreRule["kind"];

function restoreRuleFor(entry: ActivityEntry): RestoreRule | null {
  const rule: RestoreRule | undefined =
    RESTORABLE[entry.action as keyof typeof RESTORABLE];
  // `entity_type` is the kind's own name, so an event whose type disagrees
  // with its action is one this does not understand — and does not offer.
  if (!rule || entry.entityType !== rule.kind || !entry.entityId) return null;
  return rule;
}

/** The kind of thing `entry` deleted, when it is one the feed can restore. */
export function restorableKind(entry: ActivityEntry): RestorableKind | null {
  return restoreRuleFor(entry)?.kind ?? null;
}

/**
 * Which of `entries` should carry a Restore: the deletions still standing.
 *
 * The toast's Undo is on screen for eight seconds and does not wait for
 * keyboard focus, so somebody on a screen reader, a switch or a keyboard does
 * not reach it in time — and anybody who looked away has missed it too. The
 * feed is where a deletion stays on record after the toast has gone, which
 * makes it the place the way back has to stay as well.
 *
 * Only the newest deletion of each thing is offered. Something deleted,
 * restored and deleted again has two rows saying so, both of which would put
 * back the same entry; the button goes on the one that is still true.
 *
 * Nor is a deletion that was half of a change of type. Turning an expense into
 * a repayment, or the other way round, writes the new row and then deletes the
 * old one — see `convertExpenseToSettlementAction` — and putting the old one
 * back beside its replacement would count the same money twice. Those
 * deletions record `replacedBy`; ones written before it existed do not, and
 * are offered like any other.
 *
 * One query for the page, whatever it holds: the events are joined to the
 * four tables they can name, and a row survives only if the thing it names
 * is still deleted — or, for a person, still removed. Answered per row, the
 * full feed would be a hundred round trips to draw one list.
 */
export async function findRestorableDeletions(
  access: GroupAccess,
  entries: readonly ActivityEntry[],
  options: { db?: Database } = {},
): Promise<Set<string>> {
  // Every restore refuses an archived group, so an archived group offers none.
  if (access.group.archivedAt !== null) return new Set();

  const seen = new Set<string>();
  const candidates: string[] = [];
  // Newest first, as the feed is, so the first deletion met is the latest.
  for (const entry of entries) {
    const rule = restoreRuleFor(entry);
    if (!rule) continue;
    const key = `${rule.kind}:${entry.entityId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (entry.metadata?.replacedBy) continue;
    if (!access.permissions[rule.permission]) continue;
    candidates.push(entry.id);
  }
  if (candidates.length === 0) return new Set();

  const db = options.db ?? getDb();
  const rows = await db
    .select({ id: activityEvents.id })
    .from(activityEvents)
    .leftJoin(
      expenses,
      and(
        eq(activityEvents.entityType, "expense"),
        eq(expenses.id, activityEvents.entityId),
        eq(expenses.groupId, activityEvents.groupId),
      ),
    )
    .leftJoin(
      settlements,
      and(
        eq(activityEvents.entityType, "settlement"),
        eq(settlements.id, activityEvents.entityId),
        eq(settlements.groupId, activityEvents.groupId),
      ),
    )
    .leftJoin(
      recurringExpenses,
      and(
        eq(activityEvents.entityType, "recurring_expense"),
        eq(recurringExpenses.id, activityEvents.entityId),
        eq(recurringExpenses.groupId, activityEvents.groupId),
      ),
    )
    .leftJoin(
      participants,
      and(
        eq(activityEvents.entityType, "participant"),
        eq(participants.id, activityEvents.entityId),
        eq(participants.groupId, activityEvents.groupId),
      ),
    )
    .where(
      and(
        eq(activityEvents.groupId, access.groupId),
        inArray(activityEvents.id, candidates),
        or(
          isNotNull(expenses.deletedAt),
          isNotNull(settlements.deletedAt),
          isNotNull(recurringExpenses.deletedAt),
          isNotNull(participants.removedAt),
        ),
      ),
    );

  return new Set(rows.map((row) => row.id));
}
