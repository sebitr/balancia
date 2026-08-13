import { sql } from "drizzle-orm";
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { groups, participants } from "./groups";
import { users } from "./auth";

/**
 * Guest invitation links.
 *
 * The raw token is generated with 256 bits of CSPRNG entropy, shown to the
 * creator exactly once, and never stored: only its SHA-256 hash lives here.
 * That means a database leak does not hand over working invitation links, and
 * the token cannot appear in logs, backups or activity metadata.
 *
 * A link identifies a *participant*, not a person: whoever holds it acts as
 * that participant. The UI states this plainly when a link is created.
 */
export const guestInvitations = pgTable(
  "guest_invitations",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    /** SHA-256 of the raw token, hex encoded. */
    tokenHash: text("token_hash").notNull(),
    /** First bytes of the token, for "link ending in …" identification in the UI. */
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
    uniqueIndex("guest_invitations_token_hash_unique").on(table.tokenHash),
    index("guest_invitations_group_idx").on(table.groupId),
    // At most one live invitation per participant; regenerating revokes the old one.
    uniqueIndex("guest_invitations_active_participant_unique")
      .on(table.participantId)
      .where(sql`${table.revokedAt} IS NULL`),
  ],
);

/**
 * A redeemed guest session.
 *
 * Redemption exchanges the invitation token for a separate session token
 * delivered as an HttpOnly cookie, then redirects to a URL without the token —
 * so the invitation never lands in browser history, referrer headers or server
 * access logs. Only the session token's hash is stored.
 */
export const guestSessions = pgTable(
  "guest_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    invitationId: uuid("invitation_id")
      .notNull()
      .references(() => guestInvitations.id, { onDelete: "cascade" }),
    groupId: uuid("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id, { onDelete: "cascade" }),
    /** SHA-256 of the session token, hex encoded. */
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("guest_sessions_token_hash_unique").on(table.tokenHash),
    index("guest_sessions_invitation_idx").on(table.invitationId),
    index("guest_sessions_group_idx").on(table.groupId),
    index("guest_sessions_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Fixed-window rate limiting, in PostgreSQL because Balancia has no Redis.
 *
 * A row is one (bucket, window) pair; the window start is truncated so
 * counting is a single upsert. Old rows are pruned by a scheduled job.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** e.g. "signin:203.0.113.4" or "guest-redeem:<token prefix>". */
    bucket: text("bucket").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("rate_limits_bucket_window_unique").on(
      table.bucket,
      table.windowStart,
    ),
    index("rate_limits_window_idx").on(table.windowStart),
  ],
);
