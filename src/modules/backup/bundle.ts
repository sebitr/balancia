import "server-only";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import { and, asc, eq, notInArray } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { groupMembers, groups, users } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import {
  AuthorizationError,
  authorizeGroup,
  type UserActor,
} from "@/lib/security/authorization";
import { buildGroupExport, type GroupExport } from "@/modules/exports/service";
import type { ReceiptManifestEntry } from "./receipts";

/**
 * What a backup contains, and how it is named for the "did anything change?"
 * question.
 *
 * One file per run holding every group the person owns: the same lossless
 * JSON that Export produces for a single group, in a list. Reusing
 * `buildGroupExport` is deliberate and is the whole restore story — each
 * element is exactly what the import screen reads, so restoring a backup is
 * "take one group out of this list" and not a second format to maintain, and a
 * backup can never disagree with what the screens showed.
 *
 * ## Whose groups
 *
 * The ones where the person is the **owner**. A member can already export a
 * group, but backing up somebody else's group to your own cloud is a
 * different act: the data in it is shared, the owner has not agreed to it
 * leaving the server on a schedule, and the owner's own backup already covers
 * it. Each group is authorised again here, as the person, rather than read by
 * a query that skips the check — so an owner who handed the group on since
 * the last run simply stops being asked for it.
 */

export const BACKUP_FORMAT_VERSION = 1;

export interface BackupBundle {
  readonly balancia: {
    readonly backupVersion: typeof BACKUP_FORMAT_VERSION;
    readonly createdAt: string;
    /** Which installation wrote it, for the person with several. */
    readonly instance: string;
  };
  readonly groups: readonly GroupExport[];
  /**
   * The receipts that are in the cloud beside this file, one object each.
   * Absent — not empty — when the person did not ask for receipts, so a data-only
   * backup is byte-for-byte the format it always was.
   */
  readonly receipts?: readonly ReceiptManifestEntry[];
}

export interface OwnedGroup {
  readonly id: string;
  readonly name: string;
}

/** The groups this account owns, oldest first — a stable order, so a hash can be compared. */
export async function listOwnedGroups(
  userId: string,
  options: { db?: Database; excluding?: readonly string[] } = {},
): Promise<OwnedGroup[]> {
  const db = options.db ?? getDb();
  const excluding = options.excluding ?? [];
  return db
    .select({ id: groups.id, name: groups.name })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(
      and(
        eq(groupMembers.userId, userId),
        eq(groupMembers.role, "owner"),
        excluding.length > 0
          ? notInArray(groups.id, [...excluding])
          : undefined,
      ),
    )
    .orderBy(asc(groups.createdAt), asc(groups.id));
}

async function actorFor(userId: string, db: Database): Promise<UserActor> {
  const [row] = await db
    .select({ email: users.email, name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (!row) throw new Error("The account no longer exists.");
  return { kind: "user", userId, email: row.email, name: row.name };
}

export interface BuiltBundle {
  readonly bundle: BackupBundle;
  /** Groups left out because the person could no longer export them. */
  readonly skipped: readonly string[];
  readonly contentHash: string;
}

export async function buildBundle(
  userId: string,
  options: {
    excluding?: readonly string[];
    db?: Database;
    now?: Date;
    /** Receipts already safe in the cloud; omit for a data-only backup. */
    receipts?: readonly ReceiptManifestEntry[];
  } = {},
): Promise<BuiltBundle> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const actor = await actorFor(userId, db);
  const owned = await listOwnedGroups(userId, {
    db,
    excluding: options.excluding,
  });

  const exports: GroupExport[] = [];
  const skipped: string[] = [];
  for (const group of owned) {
    try {
      const access = await authorizeGroup(actor, group.id, { db });
      exports.push(await buildGroupExport(access, { db, now }));
    } catch (error) {
      // Ownership can move between the list and the check. Anything else is a
      // real failure, and one group's must not be passed off as "skipped".
      if (error instanceof AuthorizationError) {
        skipped.push(group.id);
        continue;
      }
      throw error;
    }
  }

  return {
    bundle: {
      balancia: {
        backupVersion: BACKUP_FORMAT_VERSION,
        createdAt: now.toISOString(),
        instance: new URL(getEnv().APP_URL).host,
      },
      groups: exports,
      ...(options.receipts ? { receipts: options.receipts } : {}),
    },
    skipped,
    contentHash: contentHashOf(exports, options.receipts),
  };
}

/**
 * A fingerprint of what the groups hold, blind to when it was taken.
 *
 * Each export carries the moment it was made, so hashing the files as they are
 * would call every night "changed". The timestamp is the one field blanked;
 * everything a person could have edited is in.
 */
export function contentHashOf(
  exports: readonly GroupExport[],
  receipts?: readonly ReceiptManifestEntry[],
): string {
  const stable = exports.map((entry) => ({
    ...entry,
    balancia: { ...entry.balancia, exportedAt: "" },
  }));
  return createHash("sha256")
    .update(JSON.stringify(receipts ? { groups: stable, receipts } : stable))
    .digest("hex");
}

/** The bundle as bytes: JSON, gzipped. Encrypted after, never before. */
export function serialiseBundle(bundle: BackupBundle): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"), { level: 9 });
}
