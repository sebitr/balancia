import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Identity tables.
 *
 * Balancia implements its own authentication rather than delegating to an
 * auth framework, so these are shaped for exactly what it needs and nothing
 * more. Two rules govern the design:
 *
 *  1. No secret is ever stored in a form that is useful if the database leaks.
 *     Passwords are scrypt hashes; session and verification tokens are stored
 *     as SHA-256 hashes of a value only the holder has.
 *  2. Credentials are separate rows from the user, so a person can have a
 *     password, several passkeys, or only passkeys.
 */

export const verificationPurposeEnum = pgEnum("verification_purpose", [
  "email_verification",
  "password_reset",
]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stored lowercased; `email_lookup` is what uniqueness is enforced on. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** scrypt hash. Null for an account that only has passkeys. */
    passwordHash: text("password_hash"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    // Case-insensitive uniqueness: nobody gets a second account by capitalising.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
  ],
);

/**
 * A signed-in browser session.
 *
 * Only the token's hash is stored, so a database dump cannot be replayed as a
 * live session. `expiresAt` is absolute; `lastSeenAt` supports idle display
 * and cleanup.
 */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
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
    /** Coarse context, for the "your sessions" list. Never used for authz. */
    userAgent: text("user_agent"),
    ipAddress: text("ip_address"),
  },
  (table) => [
    uniqueIndex("sessions_token_hash_unique").on(table.tokenHash),
    index("sessions_user_idx").on(table.userId),
    index("sessions_expires_idx").on(table.expiresAt),
  ],
);

/**
 * A registered WebAuthn credential (passkey).
 *
 * The public key and signature counter are what verification needs; the
 * private key never leaves the user's authenticator. Credential IDs are
 * base64url strings as produced by the browser.
 */
export const passkeys = pgTable(
  "passkeys",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** base64url credential ID from the authenticator. */
    credentialId: text("credential_id").notNull(),
    /** base64url COSE public key. */
    publicKey: text("public_key").notNull(),
    /**
     * Signature counter. A counter that goes backwards signals a cloned
     * authenticator, so it is checked on every authentication.
     */
    counter: integer("counter").notNull().default(0),
    /** "singleDevice" | "multiDevice", as reported at registration. */
    deviceType: text("device_type"),
    backedUp: boolean("backed_up").notNull().default(false),
    /** Comma-separated transports hint ("internal,hybrid"). */
    transports: text("transports"),
    /** User-chosen label, e.g. "Work laptop". */
    name: text("name"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("passkeys_credential_id_unique").on(table.credentialId),
    index("passkeys_user_idx").on(table.userId),
  ],
);

/**
 * In-flight WebAuthn challenges.
 *
 * A challenge must be single-use and short-lived, and must be checked against
 * what the server issued — keeping it server-side is what stops a replayed
 * or attacker-chosen challenge.
 */
export const webauthnChallenges = pgTable(
  "webauthn_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Null for a usernameless authentication ceremony. */
    userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
    challenge: text("challenge").notNull(),
    /** "registration" | "authentication". */
    kind: text("kind").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webauthn_challenges_challenge_unique").on(table.challenge),
    index("webauthn_challenges_expires_idx").on(table.expiresAt),
  ],
);

/**
 * Single-use tokens for email verification and password reset. Hashed, like
 * everything else that grants access.
 */
export const verificationTokens = pgTable(
  "verification_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    purpose: verificationPurposeEnum("purpose").notNull(),
    tokenHash: text("token_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("verification_tokens_hash_unique").on(table.tokenHash),
    index("verification_tokens_user_idx").on(table.userId, table.purpose),
  ],
);
