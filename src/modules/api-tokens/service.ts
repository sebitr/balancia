import "server-only";
import { and, desc, eq, isNull } from "drizzle-orm";
import { getDb, onlyRow, type Database } from "@/lib/db/client";
import { apiTokens, groups, users } from "@/lib/db/schema";
import {
  generateApiToken,
  hashToken,
  isWellFormedApiToken,
} from "@/lib/security/tokens";
import type { TokenScope } from "./scope";

/**
 * The keys an account has handed to its own software.
 *
 * Minting, listing, revoking and resolving, and nothing about what a key may
 * *do* — that is `scope.ts`, which is pure and knows nothing about a database.
 * Keeping the two apart is what lets every refusal be a table row in a unit
 * test instead of a scenario somebody has to build a group for.
 */

/** How many keys one account may have live at once. */
export const MAX_API_TOKENS = 20;

/** Long enough for "Kitchen tablet — read only", short enough for a list row. */
export const MAX_API_TOKEN_NAME = 60;

export interface ApiTokenRecord {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scope: TokenScope;
  readonly groupId: string | null;
  /** Null when the key is not pinned, or its group has since been deleted. */
  readonly groupName: string | null;
  readonly createdAt: Date;
  readonly lastUsedAt: Date | null;
}

/** What one request's bearer token turned out to be. */
export interface ResolvedApiToken {
  readonly tokenId: string;
  readonly userId: string;
  readonly email: string;
  readonly name: string;
  readonly scope: TokenScope;
  /** The one group this key may touch, or null for all of them. */
  readonly groupId: string | null;
}

export class ApiTokenError extends Error {
  /** Translated by the Server Action funnel; see `lib/server-errors.ts`. */
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = "ApiTokenError";
    this.code = code;
  }
}

/**
 * Mints a key and hands back the only copy of it that will ever exist.
 *
 * The raw value is returned once and never stored: what goes into the row is
 * its SHA-256 hash and the twelve-character prefix, so a database dump yields
 * a list of keys and no way to use one.
 *
 * The ceiling is not a security control — twenty keys are no more dangerous
 * than two — it is there so that the list on the settings screen stays a thing
 * somebody can read and act on, which is the whole of how a stale key gets
 * noticed.
 */
export async function createApiToken(
  userId: string,
  input: {
    readonly name: string;
    readonly scope: TokenScope;
    /** Already authorized by the caller — see `createApiTokenAction`. */
    readonly groupId?: string | null;
  },
  options: { db?: Database; now?: Date } = {},
): Promise<{ readonly token: string; readonly record: ApiTokenRecord }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const name = input.name.trim();
  if (name.length === 0) {
    throw new ApiTokenError("Give this key a name.", "apiTokenNameRequired");
  }
  if (name.length > MAX_API_TOKEN_NAME) {
    throw new ApiTokenError("That name is too long.", "apiTokenNameTooLong");
  }

  const live = await db
    .select({ id: apiTokens.id })
    .from(apiTokens)
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)));
  if (live.length >= MAX_API_TOKENS) {
    throw new ApiTokenError(
      "You have as many API keys as one account can hold. Revoke one first.",
      "apiTokenLimit",
    );
  }

  const token = generateApiToken();
  const createdRows = await db
    .insert(apiTokens)
    .values({
      userId,
      name,
      tokenHash: token.hash,
      prefix: token.prefix,
      scope: input.scope,
      groupId: input.groupId ?? null,
      createdAt: now,
    })
    .returning({ id: apiTokens.id });
  const created = onlyRow(createdRows, "the API token insert");

  const groupName = input.groupId
    ? ((
        await db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, input.groupId))
          .limit(1)
      )[0]?.name ?? null)
    : null;

  return {
    token: token.raw,
    record: {
      id: created.id,
      name,
      prefix: token.prefix,
      scope: input.scope,
      groupId: input.groupId ?? null,
      groupName,
      createdAt: now,
      lastUsedAt: null,
    },
  };
}

/**
 * One account's live keys, newest first.
 *
 * Revoked rows are left out rather than shown struck through: a revoked key
 * opens nothing, and a list whose job is "which of these should not still
 * exist" is worse for having dead entries in it.
 */
export async function listApiTokens(
  userId: string,
  options: { db?: Database } = {},
): Promise<ApiTokenRecord[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      prefix: apiTokens.prefix,
      scope: apiTokens.scope,
      groupId: apiTokens.groupId,
      groupName: groups.name,
      createdAt: apiTokens.createdAt,
      lastUsedAt: apiTokens.lastUsedAt,
    })
    .from(apiTokens)
    // Left, because a key pinned to nothing is the ordinary case and must not
    // be dropped from the list by the join that resolves the pinned ones.
    .leftJoin(groups, eq(groups.id, apiTokens.groupId))
    .where(and(eq(apiTokens.userId, userId), isNull(apiTokens.revokedAt)))
    .orderBy(desc(apiTokens.createdAt));

  return rows.map((row) => ({ ...row, scope: row.scope as TokenScope }));
}

/**
 * Revokes one key, if it belongs to this account.
 *
 * Scoped by `userId` in the WHERE rather than fetched and checked afterwards,
 * which is rule 1 of `security/authorization.ts` applied to a table that has no
 * group in it: somebody else's token id cannot be revoked, and cannot be
 * probed for either — the answer is the same `false` a made-up id gets.
 */
export async function revokeApiToken(
  userId: string,
  tokenId: string,
  options: { db?: Database; now?: Date } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  const revoked = await db
    .update(apiTokens)
    .set({ revokedAt: now })
    .where(
      and(
        eq(apiTokens.id, tokenId),
        eq(apiTokens.userId, userId),
        isNull(apiTokens.revokedAt),
      ),
    )
    .returning({ id: apiTokens.id });
  return revoked.length > 0;
}

/**
 * Turns a bearer value into the key it names, or null.
 *
 * Shaped like `resolveSession`, and refusing on the same grounds: malformed
 * before any query, revoked, or belonging to an account that has been
 * disabled. What it does not do is expire — there is no `expiresAt` to check,
 * for the reason written on the table.
 *
 * `lastUsedAt` is stamped on every resolution and awaited rather than left to
 * fire and forget. A session can afford to refresh its activity once an hour
 * because a browser makes fifty requests a page; a key is used by a script a
 * few times a day, and the stamp is the *only* thing that later tells its
 * owner whether the thing they pasted it into ever worked.
 */
export async function resolveApiToken(
  rawToken: string,
  options: { db?: Database; now?: Date } = {},
): Promise<ResolvedApiToken | null> {
  if (!isWellFormedApiToken(rawToken)) return null;
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [row] = await db
    .select({
      tokenId: apiTokens.id,
      scope: apiTokens.scope,
      groupId: apiTokens.groupId,
      userId: users.id,
      email: users.email,
      name: users.name,
      disabledAt: users.disabledAt,
    })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(
      and(
        eq(apiTokens.tokenHash, hashToken(rawToken)),
        isNull(apiTokens.revokedAt),
      ),
    )
    .limit(1);

  if (!row || row.disabledAt !== null) return null;

  await db
    .update(apiTokens)
    .set({ lastUsedAt: now })
    .where(eq(apiTokens.id, row.tokenId));

  return {
    tokenId: row.tokenId,
    userId: row.userId,
    email: row.email,
    name: row.name,
    scope: row.scope as TokenScope,
    groupId: row.groupId,
  };
}
