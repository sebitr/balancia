import "server-only";
import { eq } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { participants } from "@/lib/db/schema";
import { avatarHue } from "@/components/ui/avatar-hue";

/**
 * The key a face's hue is drawn from: the person's account where they have
 * one, so they are one colour across every group; the participant otherwise.
 */
export function faceKeyOf(row: {
  readonly id: string;
  readonly userId: string | null;
}): string {
  return row.userId ?? row.id;
}

/** Participant id → hue, from rows that say who has an account. */
export function huesFor(
  rows: readonly { readonly id: string; readonly userId: string | null }[],
): Record<string, number> {
  return Object.fromEntries(
    rows.map((row) => [row.id, avatarHue(faceKeyOf(row))]),
  );
}

/**
 * Every participant of a group — removed ones too, since history still draws
 * them — with the hue their face wears. The caller has authorized the group.
 */
export async function listFaceHues(
  groupId: string,
  options: { db?: Database } = {},
): Promise<Record<string, number>> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({ id: participants.id, userId: participants.userId })
    .from(participants)
    .where(eq(participants.groupId, groupId));
  return huesFor(rows);
}
