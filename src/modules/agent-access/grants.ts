import "server-only";
import { and, desc, eq, gt, isNull, lt, or } from "drizzle-orm";
import { getDb, onlyRow, type Database } from "@/lib/db/client";
import {
  agentClients,
  agentCodes,
  agentGrants,
  agentRefreshHistory,
  groups,
  users,
} from "@/lib/db/schema";
import { hashToken } from "@/lib/security/tokens";
import type { TokenScope } from "@/modules/api-tokens/scope";
import { getClient } from "./clients";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_REUSE_GRACE_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  SPENT_CODE_RETENTION_SECONDS,
} from "./constants";
import { OAuthError } from "./errors";
import { verifyCodeChallenge } from "./pkce";
import { isThisResource } from "./metadata";
import { covers, knownScope } from "./scopes";
import {
  generateAccessToken,
  generateRefreshToken,
  isWellFormedAccessToken,
  isWellFormedAuthorizationCode,
  isWellFormedRefreshToken,
} from "./tokens";

/**
 * What was agreed, and the tokens that stand for it.
 *
 * A grant is one row for its whole life. The access token and the refresh token
 * in it are replaced in place, so there is never a pile of old tokens to
 * reason about — one of each is current, and the one refresh token just
 * replaced is remembered long enough to notice if it comes back.
 *
 * Every failure of the token endpoint is `invalid_grant` unless it is
 * something the client got wrong in a way that is its own business (an unknown
 * client, a `resource` that is not this server). The reason is deliberately
 * not narrower: an unknown code, a spent one, an expired one and one that
 * belongs to somebody else must not be tell-apart-able from outside.
 */

export interface IssuedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresIn: number;
  readonly scope: TokenScope;
}

const invalidGrant = () =>
  new OAuthError(
    "invalid_grant",
    "The authorization code or refresh token is invalid, expired or already used.",
  );

function secondsFrom(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

/**
 * Turns an authorization code into a grant (RFC 6749 §4.1.3, with PKCE).
 *
 * The code is checked in full before it is spent, so a request that can only
 * fail — the wrong verifier, another client's id — cannot burn a code that
 * belongs to somebody else's still-pending sign-in. It is then spent in one
 * statement that only matches while it is unspent, so two exchanges racing for
 * one code produce one grant.
 *
 * A code that arrives after it has been spent is a replay, and RFC 6749
 * §4.1.2 says what to do: refuse it, and end what the first use made. The
 * first use may have been the legitimate client and the second a thief, or the
 * other way round; the server cannot know, and the cost of ending a grant is
 * one reconnect.
 */
export async function exchangeAuthorizationCode(
  input: {
    readonly code: string;
    readonly clientId: string;
    readonly redirectUri: string;
    readonly codeVerifier: string;
    readonly resource?: string;
  },
  origin: string,
  options: { db?: Database; now?: Date } = {},
): Promise<IssuedTokens> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  if (input.resource !== undefined && !isThisResource(input.resource, origin)) {
    throw new OAuthError(
      "invalid_target",
      "This server only issues access for its own MCP endpoint.",
    );
  }
  const client = await getClient(input.clientId, { db });
  if (!client) throw new OAuthError("invalid_client", "Unknown client.");
  if (!isWellFormedAuthorizationCode(input.code)) throw invalidGrant();

  const [code] = await db
    .select()
    .from(agentCodes)
    .where(eq(agentCodes.codeHash, hashToken(input.code)))
    .limit(1);
  if (!code) throw invalidGrant();

  if (code.usedAt !== null) {
    if (code.grantId) await revokeGrant(db, code.grantId, now);
    throw invalidGrant();
  }
  if (
    code.expiresAt <= now ||
    code.clientId !== client.id ||
    code.redirectUri !== input.redirectUri ||
    !verifyCodeChallenge(input.codeVerifier, code.codeChallenge)
  ) {
    throw invalidGrant();
  }

  const access = generateAccessToken();
  const refresh = generateRefreshToken();

  const issued = await db.transaction(async (tx) => {
    const [spent] = await tx
      .update(agentCodes)
      .set({ usedAt: now })
      .where(and(eq(agentCodes.id, code.id), isNull(agentCodes.usedAt)))
      .returning({ id: agentCodes.id });
    // Somebody spent it between the read above and here. Answered after the
    // transaction, not by throwing in it: a throw rolls back anything written
    // inside, and the first thing to do about a raced code is revoke.
    if (!spent) return "raced" as const;

    const [owner] = await tx
      .select({ disabledAt: users.disabledAt })
      .from(users)
      .where(eq(users.id, code.userId))
      .limit(1);
    if (!owner || owner.disabledAt !== null) throw invalidGrant();

    const grant = onlyRow(
      await tx
        .insert(agentGrants)
        .values({
          userId: code.userId,
          clientId: code.clientId,
          scope: code.scope,
          groupId: code.groupId,
          accessTokenHash: access.hash,
          accessExpiresAt: secondsFrom(now, ACCESS_TOKEN_TTL_SECONDS),
          refreshTokenHash: refresh.hash,
          refreshExpiresAt: secondsFrom(now, REFRESH_TOKEN_TTL_SECONDS),
          createdAt: now,
        })
        .returning({ id: agentGrants.id }),
      "the grant insert",
    );
    await tx
      .update(agentCodes)
      .set({ grantId: grant.id })
      .where(eq(agentCodes.id, code.id));

    return {
      accessToken: access.raw,
      refreshToken: refresh.raw,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
      scope: code.scope,
    };
  });

  if (issued === "raced") {
    // The loser of a race for one code is in the same position as the second
    // use of a spent one: whoever won holds a grant the person may never have
    // meant to give them, and which of the two was the application is not
    // something this server can tell. The winner's transaction has committed by
    // the time this statement ran — the loser's update waited on its row lock —
    // so the grant is readable here.
    const [spent] = await db
      .select({ grantId: agentCodes.grantId })
      .from(agentCodes)
      .where(eq(agentCodes.id, code.id))
      .limit(1);
    if (spent?.grantId) await revokeGrant(db, spent.grantId, now);
    throw invalidGrant();
  }
  return issued;
}

/**
 * Replaces a grant's tokens with a fresh pair (RFC 6749 §6, RFC 9700 §4.14).
 *
 * The refresh token is single-use. Whoever presents the current one gets the
 * next pair and the current one stops working — so a stolen copy and the
 * legitimate client cannot both keep going, and the first of them to refresh
 * locks the other out.
 *
 * A token that has already been replaced is the interesting case. Within a few
 * seconds of the replacement it is almost certainly two requests that left
 * together, and the answer is `invalid_grant` for the loser and nothing worse.
 * Later than that it is either a client that kept an old token or a thief
 * using one, and the grant is ended: a legitimate client reconnects once, and a
 * thief loses the access they were trying to keep.
 */
export async function refreshGrant(
  input: {
    readonly refreshToken: string;
    readonly clientId: string;
    readonly scope?: string;
    readonly resource?: string;
  },
  origin: string,
  options: { db?: Database; now?: Date } = {},
): Promise<IssuedTokens> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  if (input.resource !== undefined && !isThisResource(input.resource, origin)) {
    throw new OAuthError(
      "invalid_target",
      "This server only issues access for its own MCP endpoint.",
    );
  }
  const client = await getClient(input.clientId, { db });
  if (!client) throw new OAuthError("invalid_client", "Unknown client.");
  if (!isWellFormedRefreshToken(input.refreshToken)) throw invalidGrant();

  const presented = hashToken(input.refreshToken);
  const [grant] = await db
    .select()
    .from(agentGrants)
    .where(eq(agentGrants.refreshTokenHash, presented))
    .limit(1);

  if (!grant) {
    // Not the current token. Is it one that was, at any point? Every replaced
    // token is remembered — see `agent_refresh_history` for why the latest alone
    // is not enough — so a thief cannot hide the one they stole under a second
    // rotation.
    const [replaced] = await db
      .select({
        grantId: agentRefreshHistory.grantId,
        replacedAt: agentRefreshHistory.replacedAt,
        clientId: agentGrants.clientId,
        revokedAt: agentGrants.revokedAt,
      })
      .from(agentRefreshHistory)
      .innerJoin(agentGrants, eq(agentGrants.id, agentRefreshHistory.grantId))
      .where(eq(agentRefreshHistory.tokenHash, presented))
      .limit(1);
    if (
      replaced &&
      replaced.clientId === client.id &&
      replaced.revokedAt === null &&
      now.getTime() - replaced.replacedAt.getTime() >
        REFRESH_REUSE_GRACE_SECONDS * 1000
    ) {
      await revokeGrant(db, replaced.grantId, now);
    }
    throw invalidGrant();
  }

  if (
    grant.revokedAt !== null ||
    grant.refreshExpiresAt <= now ||
    grant.clientId !== client.id
  ) {
    throw invalidGrant();
  }
  // A refresh may ask for less than was granted, never more. The grant keeps
  // what it had; the response says so.
  const asked = knownScope(input.scope);
  if (asked !== null && !covers(grant.scope, asked)) {
    throw new OAuthError(
      "invalid_scope",
      "That is more than this connection was allowed.",
    );
  }

  const [owner] = await db
    .select({ disabledAt: users.disabledAt })
    .from(users)
    .where(eq(users.id, grant.userId))
    .limit(1);
  if (!owner || owner.disabledAt !== null) throw invalidGrant();

  const access = generateAccessToken();
  const refresh = generateRefreshToken();
  const rotated = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(agentGrants)
      .set({
        accessTokenHash: access.hash,
        accessExpiresAt: secondsFrom(now, ACCESS_TOKEN_TTL_SECONDS),
        refreshTokenHash: refresh.hash,
        refreshExpiresAt: secondsFrom(now, REFRESH_TOKEN_TTL_SECONDS),
      })
      .where(
        and(
          eq(agentGrants.id, grant.id),
          eq(agentGrants.refreshTokenHash, presented),
          isNull(agentGrants.revokedAt),
        ),
      )
      .returning({ id: agentGrants.id });
    if (!row) return false;
    // In the same transaction as the replacement, so the old token is never
    // neither current nor remembered.
    await tx.insert(agentRefreshHistory).values({
      tokenHash: presented,
      grantId: grant.id,
      replacedAt: now,
      expiresAt: grant.refreshExpiresAt,
    });
    return true;
  });
  // Lost the race for the same token to another request: the winner has the
  // new pair, and this one is the stale copy of the old.
  if (!rotated) throw invalidGrant();

  return {
    accessToken: access.raw,
    refreshToken: refresh.raw,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    scope: grant.scope,
  };
}

/** Who and what an access token stands for. */
export interface ResolvedGrant {
  readonly grantId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly scope: TokenScope;
  /** The one group this connection may touch, or null for all of them. */
  readonly groupId: string | null;
  readonly clientName: string;
  readonly expiresAt: Date;
}

/**
 * Turns a bearer value into the grant it names, or null.
 *
 * Shaped like `resolveApiToken` and refusing on the same grounds: malformed
 * before any query, revoked, expired, or belonging to an account that has been
 * disabled. `lastUsedAt` is stamped on every resolution so the Security screen
 * can say a connection was never used — the line that makes a forgotten one
 * visible.
 */
export async function resolveAccessToken(
  raw: string,
  options: { db?: Database; now?: Date } = {},
): Promise<ResolvedGrant | null> {
  if (!isWellFormedAccessToken(raw)) return null;
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [row] = await db
    .select({
      grantId: agentGrants.id,
      scope: agentGrants.scope,
      groupId: agentGrants.groupId,
      expiresAt: agentGrants.accessExpiresAt,
      userId: users.id,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
      clientName: agentClients.name,
    })
    .from(agentGrants)
    .innerJoin(users, eq(users.id, agentGrants.userId))
    .innerJoin(agentClients, eq(agentClients.id, agentGrants.clientId))
    .where(
      and(
        eq(agentGrants.accessTokenHash, hashToken(raw)),
        isNull(agentGrants.revokedAt),
        gt(agentGrants.accessExpiresAt, now),
      ),
    )
    .limit(1);
  if (!row || row.disabledAt !== null) return null;

  await db
    .update(agentGrants)
    .set({ lastUsedAt: now })
    .where(eq(agentGrants.id, row.grantId));

  return {
    grantId: row.grantId,
    userId: row.userId,
    email: row.email,
    name: row.name,
    scope: row.scope,
    groupId: row.groupId,
    clientName: row.clientName,
    expiresAt: row.expiresAt,
  };
}

async function revokeGrant(
  db: Database,
  grantId: string,
  now: Date,
): Promise<void> {
  await db
    .update(agentGrants)
    .set({ revokedAt: now })
    .where(and(eq(agentGrants.id, grantId), isNull(agentGrants.revokedAt)));
}

/**
 * RFC 7009: the client says it is done with a token.
 *
 * Revoking either token ends the grant, because an access token that outlives
 * the refresh token it came with is a door left open for the rest of its hour.
 * The answer never says whether the token was real — a client that is told
 * "no such token" has learned something about which tokens exist.
 */
export async function revokeByToken(
  raw: string,
  clientId: string | undefined,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const hash = hashToken(raw);
  const [grant] = await db
    .select({ id: agentGrants.id, clientId: agentGrants.clientId })
    .from(agentGrants)
    .where(
      or(
        eq(agentGrants.accessTokenHash, hash),
        eq(agentGrants.refreshTokenHash, hash),
      ),
    )
    .limit(1);
  if (!grant) return;
  // A client may only retire its own tokens. When it does not say which client
  // it is, the token alone is the proof — it is a bearer secret already.
  if (clientId !== undefined && grant.clientId !== clientId) return;
  await revokeGrant(db, grant.id, now);
}

export interface AgentConnection {
  readonly id: string;
  readonly clientName: string;
  readonly scope: TokenScope;
  readonly groupId: string | null;
  /** Null when the connection is not pinned, or its group has since gone. */
  readonly groupName: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

/** An account's live connections, newest first. */
export async function listConnections(
  userId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<AgentConnection[]> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  return db
    .select({
      id: agentGrants.id,
      clientName: agentClients.name,
      scope: agentGrants.scope,
      groupId: agentGrants.groupId,
      groupName: groups.name,
      createdAt: agentGrants.createdAt,
      lastUsedAt: agentGrants.lastUsedAt,
    })
    .from(agentGrants)
    .innerJoin(agentClients, eq(agentClients.id, agentGrants.clientId))
    .leftJoin(groups, eq(groups.id, agentGrants.groupId))
    .where(
      and(
        eq(agentGrants.userId, userId),
        isNull(agentGrants.revokedAt),
        gt(agentGrants.refreshExpiresAt, now),
      ),
    )
    .orderBy(desc(agentGrants.createdAt));
}

/** Ends one connection, if it is this account's. */
export async function disconnect(
  userId: string,
  grantId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const revoked = await db
    .update(agentGrants)
    .set({ revokedAt: options.now ?? new Date() })
    .where(
      and(
        eq(agentGrants.id, grantId),
        eq(agentGrants.userId, userId),
        isNull(agentGrants.revokedAt),
      ),
    )
    .returning({ id: agentGrants.id });
  return revoked.length > 0;
}

/**
 * Ends every connection an account has — for the moments an account is taken
 * back rather than tidied, for the reasons `revokeAllApiTokensForUser` gives.
 */
export async function disconnectAll(
  userId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  // Codes first, and only the unspent ones. "Allow" mints a code that is good
  // for five minutes, so somebody holding a stolen session could keep one
  // ready, wait for the owner's password reset, and exchange it afterwards for
  // a fresh ninety-day grant — which is exactly what ending every grant is meant
  // to prevent. In this order an exchange already in flight has either spent
  // its code (and its grant is committed before the revocation below runs) or
  // finds nothing to spend.
  await db
    .delete(agentCodes)
    .where(and(eq(agentCodes.userId, userId), isNull(agentCodes.usedAt)));
  const revoked = await db
    .update(agentGrants)
    .set({ revokedAt: options.now ?? new Date() })
    .where(and(eq(agentGrants.userId, userId), isNull(agentGrants.revokedAt)))
    .returning({ id: agentGrants.id });
  return revoked.length;
}

/**
 * Sweeps what can no longer matter: codes a day past their life (long enough
 * to still catch a replay), and grants that ended a month ago.
 */
export async function pruneAgentAccess(
  options: { db?: Database; now?: Date } = {},
): Promise<{ codes: number; grants: number }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const codes = await db
    .delete(agentCodes)
    .where(
      lt(
        agentCodes.expiresAt,
        new Date(now.getTime() - SPENT_CODE_RETENTION_SECONDS * 1000),
      ),
    )
    .returning({ id: agentCodes.id });
  const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const ended = await db
    .delete(agentGrants)
    .where(
      or(
        lt(agentGrants.revokedAt, monthAgo),
        lt(agentGrants.refreshExpiresAt, monthAgo),
      ),
    )
    .returning({ id: agentGrants.id });
  // A replaced token past the day it would have lapsed anyway tells nothing.
  await db
    .delete(agentRefreshHistory)
    .where(lt(agentRefreshHistory.expiresAt, now));
  return { codes: codes.length, grants: ended.length };
}
