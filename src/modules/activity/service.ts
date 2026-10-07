import "server-only";
import { and, desc, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import {
  activityEvents,
  expenses,
  participants,
  recurringExpenses,
  settlements,
} from "@/lib/db/schema";
import { foldConversions, type ReplacedEntry } from "./fold";
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
    /*
     * The clock, not the transaction. `now()` — the column's default — is the
     * moment the transaction began, so everything one transaction wrote carried
     * the same instant and the feed had no way to say which came first. A change
     * of type writes a repayment and deletes an expense in one commit, and the
     * two lines swapped places at random. `clock_timestamp()` moves with each
     * statement, so a transaction's events keep the order they were written in.
     */
    createdAt: sql`clock_timestamp()`,
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
   * The actor's own row in the group, when they had one. Read so a line can
   * tell when the person it names is the one who did it: a removal whose
   * actor is the person removed is somebody leaving, and a repayment whose
   * actor is the payer is "their repayment". Null for the system, and once
   * that row is gone.
   */
  readonly actorParticipantId: string | null;
  readonly createdAt: Date;
  /**
   * The event this one stands in for, when the two were one act.
   *
   * Changing an entry from an expense into a repayment, or back, writes the new
   * row and deletes the old one in a single transaction, so the log holds two
   * events for what the reader did once. `listGroupActivity` folds such a pair
   * into the creation, and keeps the deletion here so the line can say what the
   * entry was before. See `foldConversions`.
   */
  readonly replaces?: ReplacedEntry;
}

type EventRow = Omit<ActivityEntry, "replaces"> & {
  readonly actorUserId: string | null;
};

/**
 * Gives an event whose actor left no participant row the one they have now.
 *
 * An import is finished by the worker, minutes after the person who started it
 * left the page, and its event records an account and no one in the group. The
 * account has a seat in this group, and the seat has a name — the one every
 * other screen shows for them.
 */
async function withActorSeats(
  db: Database,
  groupId: string,
  rows: readonly EventRow[],
): Promise<EventRow[]> {
  const userIds = [
    ...new Set(
      rows.flatMap((row) =>
        row.actorParticipantId === null && row.actorUserId !== null
          ? [row.actorUserId]
          : [],
      ),
    ),
  ];
  if (userIds.length === 0) return [...rows];

  const seats = await db
    .select({ id: participants.id, userId: participants.userId })
    .from(participants)
    .where(
      and(
        eq(participants.groupId, groupId),
        inArray(participants.userId, userIds),
      ),
    );
  const seatOf = new Map(seats.map((seat) => [seat.userId, seat.id]));

  return rows.map((row) =>
    row.actorParticipantId === null && row.actorUserId !== null
      ? { ...row, actorParticipantId: seatOf.get(row.actorUserId) ?? null }
      : row,
  );
}

/**
 * Gives a repayment event the two people it was between, when it never said.
 *
 * Only the event that created a repayment recorded `from` and `to`; the ones
 * that edited, deleted or restored it recorded an amount alone, which is why
 * those lines read "deleted a repayment" and nothing more. The repayment row
 * outlives its own deletion, and it knows who paid whom, so the answer is one
 * query away — for every event ever written, not just the ones from here on.
 */
async function withRepaymentParties(
  db: Database,
  groupId: string,
  rows: readonly EventRow[],
): Promise<EventRow[]> {
  const unknown = (row: EventRow): boolean =>
    row.entityType === "settlement" &&
    row.entityId !== null &&
    row.action.startsWith("settlement.") &&
    !(
      typeof row.metadata?.from === "string" &&
      typeof row.metadata?.to === "string"
    );

  const ids = [
    ...new Set(rows.flatMap((row) => (unknown(row) ? [row.entityId!] : []))),
  ];
  if (ids.length === 0) return [...rows];

  const found = await db
    .select({
      id: settlements.id,
      from: settlements.fromParticipantId,
      to: settlements.toParticipantId,
    })
    .from(settlements)
    .where(and(eq(settlements.groupId, groupId), inArray(settlements.id, ids)));
  const parties = new Map(found.map((row) => [row.id, row]));

  return rows.map((row) => {
    const known = unknown(row) ? parties.get(row.entityId!) : undefined;
    if (!known) return row;
    return {
      ...row,
      metadata: { ...row.metadata, from: known.from, to: known.to },
    };
  });
}

/**
 * Recent activity for a group. Always called with an authorized group ID.
 *
 * Read for a person, by default: a change of type is one entry rather than two,
 * a repayment's event names the two ends it was between, and an event the
 * worker wrote on somebody's behalf has that person as its actor. `raw` is the
 * rows as they were written, for the mobile API, whose clients word the events
 * themselves and were written against that shape.
 */
export async function listGroupActivity(
  groupId: string,
  options: { limit?: number; db?: Database; raw?: boolean } = {},
): Promise<ActivityEntry[]> {
  const db = options.db ?? getDb();
  const limit = options.limit ?? 25;
  const rows = await db
    .select({
      id: activityEvents.id,
      action: activityEvents.action,
      entityType: activityEvents.entityType,
      entityId: activityEvents.entityId,
      metadata: activityEvents.metadata,
      actorLabel: activityEvents.actorLabel,
      actorType: activityEvents.actorType,
      actorUserId: activityEvents.actorUserId,
      actorParticipantId: activityEvents.actorParticipantId,
      createdAt: activityEvents.createdAt,
    })
    .from(activityEvents)
    .where(eq(activityEvents.groupId, groupId))
    // The id is only there so that two events at one instant — every event
    // written before the clock moved within a transaction — come back in the
    // same order each time, rather than whichever the planner reached first.
    .orderBy(desc(activityEvents.createdAt), desc(activityEvents.id))
    // One more than asked for when folding, so that a pair split by the edge
    // of the page is still found: its halves are adjacent.
    .limit(options.raw ? limit : limit + 1);

  const events: EventRow[] = rows.map((row) => ({
    ...row,
    metadata: (row.metadata as ActivityMetadata | null) ?? null,
  }));
  // The account an event was written under is for resolving its seat above;
  // nothing past this point, and nothing on the wire, carries it.
  const withoutAccount = (row: EventRow): ActivityEntry => ({
    id: row.id,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    metadata: row.metadata,
    actorLabel: row.actorLabel,
    actorType: row.actorType,
    actorParticipantId: row.actorParticipantId,
    createdAt: row.createdAt,
  });

  if (options.raw) return events.map(withoutAccount);

  const seated = await withActorSeats(db, groupId, events);
  const withParties = await withRepaymentParties(db, groupId, seated);
  return foldConversions(withParties.map(withoutAccount)).slice(0, limit);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The participant ids an event's line names: whoever did it, whoever it was
 * done to, and the two ends of a repayment.
 *
 * Events record people by id, never by name, wherever they can — a name
 * changes and an id does not — and the screen that lists them looks the names
 * up once for the page.
 */
function peopleNamedBy(entry: ActivityEntry): string[] {
  const ids: unknown[] = [entry.actorParticipantId];
  for (const metadata of [entry.metadata, entry.replaces?.metadata]) {
    if (!metadata) continue;
    ids.push(metadata.from, metadata.to, metadata.participantId);
  }
  if (
    entry.entityType === "participant" ||
    entry.entityType === "group_member"
  ) {
    ids.push(entry.entityId);
  }
  // Metadata is free-form JSON; anything that is not an id would make the
  // uuid comparison below throw rather than simply match nothing.
  return ids.filter(
    (id): id is string => typeof id === "string" && UUID.test(id),
  );
}

/**
 * The current names of the people `entries` point at, by participant id.
 *
 * One query for the page, and none at all when nothing on it names anybody.
 * Removed people are included: a repayment from somebody who has since left
 * the group still happened, and still has two ends.
 *
 * The actor is among them. An event keeps the label its actor had when it was
 * written, which is the name on their *account* — and a group knows people by
 * the name they chose in it, so a feed that printed the label called one
 * person two things on two screens, and called somebody with no label at all
 * "Someone".
 *
 * Scoped to `groupId`, which the caller has already authorized, so an id in
 * an event's metadata can never resolve to somebody in another group.
 */
export async function namesInActivity(
  groupId: string,
  entries: readonly ActivityEntry[],
  options: { db?: Database } = {},
): Promise<Map<string, string>> {
  const ids = [...new Set(entries.flatMap(peopleNamedBy))];
  if (ids.length === 0) return new Map();

  const db = options.db ?? getDb();
  const rows = await db
    .select({ id: participants.id, displayName: participants.displayName })
    .from(participants)
    .where(
      and(eq(participants.groupId, groupId), inArray(participants.id, ids)),
    );

  return new Map(rows.map((row) => [row.id, row.displayName]));
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
