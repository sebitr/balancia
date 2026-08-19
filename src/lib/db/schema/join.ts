import { sql } from "drizzle-orm";
import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { groups } from "./groups";
import { users } from "./auth";

/**
 * The group-wide join link.
 *
 * Distinct from `guestInvitations`, which names a participant: whoever holds
 * one of those *is* that participant. This link names only the group, so the
 * person opening it has not yet been identified — deciding who they are is the
 * whole job of the onboarding flow behind it. One link goes in the group chat
 * and everybody uses the same one.
 *
 * The two coexist. A per-participant link is still the right thing to send to
 * one named person; this is the right thing to paste where five people will
 * read it.
 *
 * Storage follows the same rules as every other token here: 256 bits of
 * entropy, only the SHA-256 hash persisted, a short prefix kept so the UI can
 * say which link it is showing without revealing it.
 */
export const groupJoinLinks = pgTable(
  "group_join_links",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    /** SHA-256 of the raw token, hex encoded. */
    tokenHash: text("token_hash").notNull(),
    /** First bytes of the token, for "link ending in …" in the UI. */
    tokenPrefix: text("token_prefix").notNull(),
    createdByUserId: uuid("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("group_join_links_token_hash_unique").on(table.tokenHash),
    index("group_join_links_group_idx").on(table.groupId),
    // At most one live link per group; regenerating revokes the old one, which
    // is what makes "the link got out" recoverable in a single action.
    uniqueIndex("group_join_links_active_group_unique")
      .on(table.groupId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);
