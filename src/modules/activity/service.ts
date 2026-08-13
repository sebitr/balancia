import "server-only";
import { desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { activityEvents } from "@/lib/db/schema";
import type { GroupAccess } from "@/lib/security/authorization";

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
