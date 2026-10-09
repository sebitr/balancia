import {
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { apiTokenScopeEnum, users } from "./auth";
import { groups } from "./groups";

/**
 * Balancia as an OAuth 2.1 authorization server, for AI agents.
 *
 * Claude and ChatGPT add a connector by its address and then send the person
 * through a sign-in and consent screen on the server they named. That screen
 * hands back a code, the code becomes an access token, and the token is what
 * `/mcp` accepts. These tables are the whole of that: who asked
 * (`agent_clients`), the single-use step in the middle (`agent_codes`), what
 * was agreed (`agent_grants`), and the refresh tokens that have been replaced
 * (`agent_refresh_history`), kept so that a stolen one is noticed.
 *
 * The same two rules as every other credential table here:
 *
 *  1. No secret is stored in a form that is useful if the database leaks.
 *     Codes, access tokens and refresh tokens are kept as SHA-256 hashes of a
 *     value only the holder has.
 *  2. What a grant may do is the same two axes an API key has — read or write,
 *     and optionally one group — and nothing finer. A grant authenticates as
 *     its owner and can only ever do less than they could.
 *
 * Named for what they are for rather than `oauth_*`: `oauth_identities` is the
 * other direction, Balancia as a client of Sign in with Apple.
 */

/**
 * An application that asked to be let in: Claude, ChatGPT, an editor.
 *
 * Registered by the application itself (RFC 7591), unauthenticated, so a row
 * here means nothing more than "somebody posted this name and these redirect
 * addresses". It confers no access. The consent screen shows the name and the
 * address the answer will go to, and the person decides.
 *
 * Public clients only — there is no secret column. Every client Balancia talks
 * to runs on a phone, a laptop or a vendor's server it cannot keep a secret on
 * behalf of, and PKCE is what binds a code to the application that asked.
 */
export const agentClients = pgTable(
  "agent_clients",
  {
    /** The `client_id` — a UUID, so it is unguessable and carries no meaning. */
    id: uuid("id").defaultRandom().primaryKey(),
    /** What the application calls itself. Shown to a person, never trusted. */
    name: text("name").notNull(),
    /**
     * Where the answer may be sent, matched exactly. The one rule a loopback
     * address bends: its port is whatever the application's listener got.
     */
    redirectUris: text("redirect_uris").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When a person last allowed it. A client nobody has ever allowed is an
     * unauthenticated POST that nothing came of, and the worker sweeps it away
     * after a week.
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (table) => [index("agent_clients_created_idx").on(table.createdAt)],
);

/**
 * The step between "yes" and a token: valid for one exchange, for a few
 * minutes, by whoever holds the PKCE verifier that goes with it.
 *
 * Kept after it is spent, with the grant it produced, so that a second attempt
 * to use it can be recognised for what it is (RFC 6749 §4.1.2) and the grant it
 * made ended. A code that is simply deleted on use makes that replay look
 * exactly like a code that never existed.
 */
export const agentCodes = pgTable(
  "agent_codes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    /** SHA-256 of the code, hex encoded. */
    codeHash: text("code_hash").notNull(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => agentClients.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Exactly what the request named; the exchange must name it again. */
    redirectUri: text("redirect_uri").notNull(),
    /** The S256 challenge. There is no `plain`. */
    codeChallenge: text("code_challenge").notNull(),
    scope: apiTokenScopeEnum("scope").notNull(),
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Set by the exchange that spends it, in the same statement. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** The grant the exchange made, so a replay can end it. */
    grantId: uuid("grant_id"),
  },
  (table) => [
    uniqueIndex("agent_codes_code_hash_unique").on(table.codeHash),
    index("agent_codes_expires_idx").on(table.expiresAt),
  ],
);

/**
 * One person's yes to one application: a scope, perhaps a group, and the pair
 * of tokens that currently stand for it.
 *
 * The tokens rotate inside the row. An access token lives an hour; the refresh
 * token that replaces it is single-use, and so is the one it replaces in turn.
 * Every token that has been replaced is remembered (`agent_refresh_history`),
 * because a token that arrives after it has been replaced is either a stale
 * retry or a stolen copy, a server cannot tell which, and ending the grant is
 * the answer that is safe for the second at the price of one reconnect for the
 * first.
 *
 * This row is what the Security screen lists. Revoking it ends the access
 * token and the refresh token together.
 */
export const agentGrants = pgTable(
  "agent_grants",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => agentClients.id, { onDelete: "cascade" }),
    scope: apiTokenScopeEnum("scope").notNull(),
    /**
     * The one group this grant may touch, or null for all of them. Cascades
     * with the group, for the reason an API key's pin does.
     */
    groupId: uuid("group_id").references(() => groups.id, {
      onDelete: "cascade",
    }),
    accessTokenHash: text("access_token_hash").notNull(),
    accessExpiresAt: timestamp("access_expires_at", {
      withTimezone: true,
    }).notNull(),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    refreshExpiresAt: timestamp("refresh_expires_at", {
      withTimezone: true,
    }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /**
     * When an access token of this grant last authenticated a request. Null
     * means the application asked to be let in, was, and has not called since.
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("agent_grants_access_hash_unique").on(table.accessTokenHash),
    uniqueIndex("agent_grants_refresh_hash_unique").on(table.refreshTokenHash),
    index("agent_grants_user_idx").on(table.userId),
  ],
);

/**
 * Every refresh token a grant has ever replaced, by hash.
 *
 * Remembering only the latest one is the obvious design and it is defeated by
 * refreshing twice: a thief who steals R1 and refreshes straight away — R1
 * becomes R2, then R2 becomes R3 — leaves R1 two rotations old, matching
 * nothing, and the real client presenting it hours later is told `invalid_grant`
 * and nothing is revoked. The thief keeps R3. So all of them are kept.
 *
 * A row is only worth keeping until the token would have lapsed anyway — after
 * that, seeing it again is no evidence of anything — so the worker sweeps by
 * `expires_at`, and a connection refreshed every hour holds about two thousand
 * short rows, not an ever-growing list. They go with their grant.
 */
export const agentRefreshHistory = pgTable(
  "agent_refresh_history",
  {
    /** SHA-256 of the replaced refresh token. The key: lookups are by this. */
    tokenHash: text("token_hash").primaryKey(),
    grantId: uuid("grant_id")
      .notNull()
      .references(() => agentGrants.id, { onDelete: "cascade" }),
    /**
     * When it was replaced. It is forgiven for a few seconds after this — two
     * requests that left together both name it, and the loser is a race, not a
     * theft — and treated as stolen after that.
     */
    replacedAt: timestamp("replaced_at", { withTimezone: true }).notNull(),
    /** When it would have lapsed on its own. */
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [
    index("agent_refresh_history_grant_idx").on(table.grantId),
    index("agent_refresh_history_expires_idx").on(table.expiresAt),
  ],
);
