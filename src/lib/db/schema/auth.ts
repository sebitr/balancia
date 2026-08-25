import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  "email_change",
]);

export const oauthProviderEnum = pgEnum("oauth_provider", ["apple"]);

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
    /**
     * Preferred interface language ("en", "fr"). Null means "not chosen yet",
     * which falls back to the browser's Accept-Language. Stored so the choice
     * follows the account onto a new device, where there is no cookie yet.
     */
    locale: text("locale"),
    /**
     * ISO 4217 code the home screen totals every group position into. Null
     * means "not chosen yet", and the dashboard falls back to whichever
     * currency the user's own groups balance in most often.
     */
    preferredCurrency: text("preferred_currency"),
    /**
     * Currencies this account has starred, in the order it starred them —
     * most recently added last, which is the order the picker pins them in.
     *
     * Empty is the ordinary state of a new account, not an error: the picker
     * then shows no favourites section and the reader builds one by starring
     * rows. Per account rather than per group on purpose — where somebody
     * spends money does not change with which group they are looking at.
     */
    favoriteCurrencies: text("favorite_currencies")
      .array()
      .notNull()
      .default(sql`'{}'`),
    /**
     * How dates are written ("dmy", "mdy", "ymd"). Null means "not chosen
     * yet", which follows the reader's language and region. Kept apart from
     * `locale` because notation and language are separate choices: English in
     * Paris is still 13/08/2026.
     */
    dateFormat: text("date_format"),
    /** How numbers are written ("comma-dot", "dot-comma", "space-comma"). */
    numberFormat: text("number_format"),
    /**
     * Instance administrator: the person who runs this installation.
     *
     * Distinct from `group_members.role`, which is about one group's expenses.
     * This is about the deployment — today, whether anonymous telemetry is
     * switched on for everybody. The first account created on an instance gets
     * it, because on a self-hosted install that account is the operator; on an
     * existing instance the migration gave it to the oldest account for the
     * same reason. It is granted nowhere else, and there is no way to ask for
     * it: an operator promotes a second administrator with one UPDATE
     * (docs/telemetry.md).
     */
    isAdmin: boolean("is_admin").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * The account's photo, as an opaque key into the storage adapter.
     *
     * Null is the ordinary state, not a missing value: an account without a
     * photo is drawn as its initial on a tinted circle, which is what the
     * whole app shows for a participant who is not a user at all. The key is
     * server-generated like every other one — see `modules/profile/avatar.ts`.
     */
    avatarStorageKey: text("avatar_storage_key"),
    /** Sniffed from the file's magic bytes, never from what was uploaded. */
    avatarContentType: text("avatar_content_type"),
    /**
     * Stamped on every write so the delivery route can be cached hard and
     * still change the moment a new photo lands: it is the cache key.
     */
    avatarUpdatedAt: timestamp("avatar_updated_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    // Case-insensitive uniqueness: nobody gets a second account by capitalising.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    check(
      "users_preferred_currency_format",
      sql`${table.preferredCurrency} IS NULL OR ${table.preferredCurrency} ~ '^[A-Z]{3}$'`,
    ),
    // A bound rather than a format: a CHECK cannot look inside an array
    // without a subquery, so the codes themselves are validated by
    // `sanitiseFavoriteCurrencies` on every path that writes them. What the
    // column can enforce on its own is that nothing writes an unbounded list.
    check(
      "users_favorite_currencies_bounded",
      sql`cardinality(${table.favoriteCurrencies}) <= 12`,
    ),
    // "auto" is expressed as NULL rather than stored, so there is one way to
    // say "no choice" and the column cannot disagree with itself.
    check(
      "users_date_format_known",
      sql`${table.dateFormat} IS NULL OR ${table.dateFormat} IN ('dmy', 'mdy', 'ymd')`,
    ),
    check(
      "users_number_format_known",
      sql`${table.numberFormat} IS NULL OR ${table.numberFormat} IN ('comma-dot', 'dot-comma', 'space-comma')`,
    ),
    // A photo is a key and the type it was sniffed as; one without the other
    // is a row the delivery route cannot answer from, so it cannot exist.
    check(
      "users_avatar_complete",
      sql`(${table.avatarStorageKey} IS NULL) = (${table.avatarContentType} IS NULL)`,
    ),
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
 * An external identity provider's account, linked to a local user.
 *
 * A third row type alongside passwords and passkeys, for the same reason they
 * are separate rows: a person may sign in with any of them, and unlinking one
 * must not disturb the others.
 *
 * `subject` is the provider's stable identifier for the person. Apple's is
 * scoped to the developer team, so it is meaningless anywhere else and cannot
 * be correlated with another site's — but it is the only durable handle there
 * is, because the email may be a relay address that the user can switch off.
 * Uniqueness is on (provider, subject), never on email.
 */
export const oauthIdentities = pgTable(
  "oauth_identities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: oauthProviderEnum("provider").notNull(),
    /** The provider's `sub` claim. Opaque; never parsed. */
    subject: text("subject").notNull(),
    /**
     * The address the provider last reported, kept for display so someone can
     * tell which Apple ID is linked. Never used to find the account — that is
     * what `subject` is for.
     */
    email: text("email"),
    /** Apple's private relay (`@privaterelay.appleid.com`) rather than a real inbox. */
    isPrivateEmail: boolean("is_private_email").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("oauth_identities_provider_subject_unique").on(
      table.provider,
      table.subject,
    ),
    index("oauth_identities_user_idx").on(table.userId),
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
 * Single-use tokens for email verification, password reset and email change.
 * Hashed, like everything else that grants access.
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
    /**
     * The address an `email_change` is *to*, lowercased. Null for every other
     * purpose.
     *
     * Kept on the token rather than in a `pending_email` column on the user,
     * so a request that is never confirmed leaves nothing behind on the
     * account, and so the single-live-token-per-purpose rule that already
     * governs this table is what supersedes an earlier request.
     */
    newEmail: text("new_email"),
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
