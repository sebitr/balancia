import { sql } from "drizzle-orm";
import { mintWebauthnUserHandle } from "@/modules/auth/user-handle";
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
  /**
   * The two short numeric codes, kept apart from the long link tokens above
   * on purpose.
   *
   * A six-digit code has a millionth of the entropy of a link token, so it is
   * only ever safe to check against one named account. Giving each its own
   * purpose means no path that looks a token up by hash alone can ever be
   * handed one — see `codeHash` in `modules/auth/codes.ts`, which peppers the
   * digits with the account id for the same reason.
   */
  "email_verification_code",
  "sign_in_code",
]);

export const oauthProviderEnum = pgEnum("oauth_provider", ["apple"]);

export const users = pgTable(
  "users",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Stored lowercased; `email_lookup` is what uniqueness is enforced on. */
    email: text("email").notNull(),
    name: text("name").notNull(),
    /**
     * When a person chose the name above. Null means nobody has.
     *
     * Two signups write the account before anything has asked what to call
     * it — the code and passkey routes, whose name screen comes *after* the
     * address, and an Apple sign-in that arrived without a full name — and
     * both stand the address's local part in until the screen that follows
     * overwrites it. Anyone who closed the tab in between is "cold-mtke" to
     * every group they join, and nothing asked again.
     *
     * This column is what the dashboard's nudge reads, and it is a stamp
     * rather than a guess. The guess it replaces compared the name with the
     * local part on every render, which cannot tell a placeholder from
     * somebody called Seb whose address is seb@ — and nagged the second
     * reader forever. Every path that takes a name from a person stamps it;
     * the two that derive one leave it null.
     */
    nameChosenAt: timestamp("name_chosen_at", { withTimezone: true }),
    emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
    /** scrypt hash. Null for an account that only has passkeys. */
    passwordHash: text("password_hash"),
    /**
     * The account's WebAuthn user handle: what an authenticator files this
     * account's passkeys under, and the only name the Signal API answers to.
     *
     * Random rather than the row id, because this value leaves the server and
     * is kept by somebody's password manager for years. It is minted with the
     * account and never changes: the handle is how a provider decides that two
     * credentials belong to one entry in its list, so an account that changed
     * it would appear twice — which is exactly the state this column was added
     * to end. A passkey signup mints it before the row exists, so the handle
     * the ceremony committed to is carried in and stored here verbatim.
     *
     * Accounts that predate the column carry their id, because that is what
     * `startPasskeyRegistration` sent as the handle before this existed.
     *
     * Defaulted here rather than at the call sites so that no path can create
     * an account without one — a seed, a factory or a fixture that inserts a
     * user directly gets a handle it never had to think about.
     */
    webauthnUserHandle: text("webauthn_user_handle")
      .notNull()
      .$defaultFn(() => mintWebauthnUserHandle()),
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
     * Which colour the app paints what is chosen, active or still to do.
     *
     * A name from `modules/profile/accent.ts` — "mint", not an oklch triple —
     * so the palette can be retuned without a migration, and so a value that
     * reaches `--primary` is one of seven rather than whatever was stored.
     * Null is the coral the app has always used.
     */
    accentColor: text("accent_color"),
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
    /**
     * When this account last removed a passkey of its own.
     *
     * A fact rather than a preference, but one policy reads it: the silent
     * upgrade after a password sign-in will not run for an account that has
     * this stamp. Without it, somebody who deliberately removes their passkey
     * gets a new one minted behind their back the next time they type their
     * password, which is the app quietly overruling them — and doing it
     * silently, so they would only find out by visiting the settings screen
     * they had just used to say no.
     *
     * It does not stand in the way of the button. Asking for a passkey
     * explicitly is a fresh decision and always allowed; this only governs
     * what happens without being asked.
     */
    passkeyRemovedAt: timestamp("passkey_removed_at", { withTimezone: true }),
    disabledAt: timestamp("disabled_at", { withTimezone: true }),
  },
  (table) => [
    // Case-insensitive uniqueness: nobody gets a second account by capitalising.
    uniqueIndex("users_email_unique").on(sql`lower(${table.email})`),
    // Two accounts sharing a handle would share one entry in a password
    // manager's list. Thirty-two random bytes will not collide; the index is
    // what makes that a guarantee rather than an expectation.
    uniqueIndex("users_webauthn_user_handle_unique").on(
      table.webauthnUserHandle,
    ),
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
    // Same rule as the two above: NULL is "never chose one", which is coral.
    check(
      "users_accent_color_known",
      sql`${table.accentColor} IS NULL OR ${table.accentColor} IN ('coral', 'amber', 'mint', 'ocean', 'lavender', 'raspberry', 'plum')`,
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
    /**
     * The user handle this particular credential is filed under, as the
     * authenticator holds it — which is not always what `users` now says.
     *
     * Every Signal API call that reconciles a list is keyed by the handle, so
     * a credential whose handle is unknown cannot be signalled about: the
     * browser would look under a name no authenticator ever stored and
     * silently match nothing. New registrations write the account's handle
     * here. Rows that predate the column are null until their next sign-in,
     * where the assertion carries `userHandle` and repairs them — the handle a
     * passkey signup minted was discarded with its challenge row, so the
     * authenticator is the only remaining copy.
     */
    userHandle: text("user_handle"),
    /**
     * The authenticator's model identifier, as a dashed UUID.
     *
     * This is what turns a list of identical shields into "iCloud Keychain"
     * and "1Password" — the one thing that tells a reader which of their four
     * passkeys the removal sheet is about. It identifies a model, never a
     * person or a device: every iPhone in the world reports the same AAGUID
     * for iCloud Keychain, which is what makes it safe to store.
     *
     * All zeroes is the documented "declines to say" and several
     * authenticators mean it, so it is stored as null rather than looked up.
     */
    aaguid: text("aaguid"),
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
    /** "registration" | "authentication" | "signup". */
    kind: text("kind").notNull(),
    /**
     * The account a "signup" ceremony will create, held here until it does.
     *
     * Creating the user up front and attaching the passkey afterwards would be
     * the shorter path, and it is the wrong one: an abandoned ceremony would
     * leave a row owning an email address with no password and no passkey —
     * unreachable by its owner and unusable by anyone else. So the identity
     * waits on the challenge, which already expires in five minutes and is
     * already single-use, and the user row is written only once an
     * authenticator has answered.
     */
    signupEmail: text("signup_email"),
    /**
     * The name that ceremony was given, when it was given one.
     *
     * Null on a signup that never asked — the passkey button sits *before*
     * the name screen on the routes that have one — and the account it
     * creates is stamped as unnamed for the dashboard to ask about later.
     * A placeholder is derived where a ceremony needs a string to show, and
     * is never written here: this column holds what a person typed or
     * nothing at all.
     */
    signupName: text("signup_name"),
    /**
     * base64url handle minted for the signup ceremony and echoed back by the
     * authenticator. Random rather than the account id, because there is no
     * account id yet.
     */
    userHandle: text("user_handle"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("webauthn_challenges_challenge_unique").on(table.challenge),
    index("webauthn_challenges_expires_idx").on(table.expiresAt),
    index("webauthn_challenges_user_idx").on(table.userId),
    // The address and the handle are one fact and travel together, and no
    // other kind of ceremony carries them. A row that half-remembers who it
    // was going to create cannot exist. `signupName` is deliberately outside
    // this: a signup that was never told a name is an ordinary state, and the
    // account it makes is the one the dashboard asks.
    check(
      "webauthn_challenges_signup_complete",
      sql`(${table.kind} = 'signup') = (${table.signupEmail} IS NOT NULL AND ${table.userHandle} IS NOT NULL)`,
    ),
    // ...but a name on a ceremony that is not a signup is nobody's, and
    // nothing would ever read it.
    check(
      "webauthn_challenges_signup_name_scope",
      sql`${table.kind} = 'signup' OR ${table.signupName} IS NULL`,
    ),
    // Nobody is signed in during a signup, so a signup challenge that names a
    // user is a bug rather than a state.
    check(
      "webauthn_challenges_signup_anonymous",
      sql`${table.kind} <> 'signup' OR ${table.userId} IS NULL`,
    ),
  ],
);

/**
 * A proof-of-work challenge handed out before an account may be created.
 *
 * Stored rather than signed, and the row is the whole authority. A signed
 * challenge would need no table and would be replayable for as long as the
 * signature stayed valid — which defeats the point, because the cost a
 * proof-of-work imposes is per *attempt*, and an attempt that can reuse
 * yesterday's answer costs nothing. `consumedAt` is what makes it once.
 *
 * `answerHash` is the SHA-256 of the nonce followed by the number the client
 * has to find, so the answer itself is never stored and the row cannot be read
 * out of a database dump and turned into free signups.
 *
 * Only ever populated where `SIGNUP_PROOF_OF_WORK` is on, which is off by
 * default: a self-hosted instance behind a closed registration has nothing to
 * spend this on.
 */
export const proofOfWorkChallenges = pgTable(
  "proof_of_work_challenges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** Random, and the handle the client is given. */
    nonce: text("nonce").notNull(),
    /** SHA-256 of `nonce + answer`, hex encoded. */
    answerHash: text("answer_hash").notNull(),
    /** The ceiling the answer was drawn below, so the client knows when to stop. */
    maxNumber: integer("max_number").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("proof_of_work_challenges_nonce_unique").on(table.nonce),
    index("proof_of_work_challenges_expires_idx").on(table.expiresAt),
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
