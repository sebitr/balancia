import "server-only";
import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb, onlyRow, type Database } from "@/lib/db/client";
import { agentClients, agentGrants } from "@/lib/db/schema";
import { sanitizeClientName } from "./client-name";
import {
  MAX_UNUSED_CLIENTS,
  REDIRECT_URIS_MAX,
  UNUSED_CLIENT_TTL_SECONDS,
} from "./constants";
import { OAuthError } from "./errors";
import { checkRedirectUri } from "./redirect-uri";

/**
 * Applications that registered themselves (RFC 7591).
 *
 * Registration is open to anybody who can reach the server, by design: a
 * connector added by its address has never met this instance, so there is no
 * one to have given it an identity beforehand. That makes the row it leaves
 * worth almost nothing on its own — it grants no access, and the consent screen
 * says plainly what was claimed and where the answer would go — and makes
 * everything stored here untrusted text that a person will later read.
 */

export interface RegisteredClient {
  readonly id: string;
  readonly name: string;
  readonly redirectUris: readonly string[];
  readonly createdAt: Date;
}

const registrationSchema = z.object({
  client_name: z.unknown().optional(),
  redirect_uris: z.array(z.unknown()).min(1).max(REDIRECT_URIS_MAX),
});

/**
 * Validates a registration request and stores it.
 *
 * Fields this server has no use for — `grant_types`, `scope`, `logo_uri`,
 * `token_endpoint_auth_method` and the rest — are ignored rather than refused,
 * and the response says what the client actually got. RFC 7591 §3.2.1 allows
 * exactly that, and it is what lets a client that asks for more than a public
 * PKCE client can have register at all.
 */
export async function registerClient(
  body: unknown,
  options: { db?: Database; now?: Date } = {},
): Promise<RegisteredClient> {
  const parsed = registrationSchema.safeParse(body);
  if (!parsed.success) {
    throw new OAuthError(
      "invalid_client_metadata",
      "redirect_uris must list between 1 and 5 addresses.",
    );
  }

  const redirectUris: string[] = [];
  for (const candidate of parsed.data.redirect_uris) {
    const check = checkRedirectUri(candidate);
    if (!check.ok) {
      throw new OAuthError("invalid_redirect_uri", check.reason);
    }
    redirectUris.push(candidate as string);
  }

  const db = options.db ?? getDb();
  const rows = await db
    .insert(agentClients)
    .values({
      name: sanitizeClientName(parsed.data.client_name),
      redirectUris: [...new Set(redirectUris)],
      createdAt: options.now ?? new Date(),
    })
    .returning();
  const client = toClient(onlyRow(rows, "the client insert"));
  await capUnusedClients({ db });
  return client;
}

/**
 * Keeps the registrations nobody has allowed to the newest `MAX_UNUSED_CLIENTS`.
 *
 * Registration is open to anybody, so something has to stop the table being
 * filled, and the first answer — a ceiling on registrations per hour across the
 * instance — is a way to switch the whole feature off from outside: whoever
 * spends the allowance, from a handful of addresses, stops every real person
 * connecting anything until the hour turns. This bounds the same thing without
 * refusing anybody. The oldest unused registration is dropped to make room, which
 * costs a person nothing unless they were slower than a flood, and then costs
 * them one more attempt.
 *
 * A client that has ever been allowed, or holds a grant, is never dropped here.
 */
export async function capUnusedClients(
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const unused = and(
    isNull(agentClients.lastUsedAt),
    sql`NOT EXISTS (SELECT 1 FROM ${agentGrants} WHERE ${agentGrants.clientId} = ${agentClients.id})`,
  );
  const [counted] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentClients)
    .where(unused);
  const excess = (counted?.n ?? 0) - MAX_UNUSED_CLIENTS;
  if (excess <= 0) return 0;

  const oldest = await db
    .select({ id: agentClients.id })
    .from(agentClients)
    .where(unused)
    .orderBy(asc(agentClients.createdAt))
    .limit(excess);
  const removed = await db
    .delete(agentClients)
    .where(
      inArray(
        agentClients.id,
        oldest.map((row) => row.id),
      ),
    )
    .returning({ id: agentClients.id });
  return removed.length;
}

const uuidSchema = z.uuid();

/** A registered client, or null — including for an id that is not a UUID. */
export async function getClient(
  id: string,
  options: { db?: Database } = {},
): Promise<RegisteredClient | null> {
  // PostgreSQL throws on a malformed UUID before it consults any row.
  if (!uuidSchema.safeParse(id).success) return null;
  const db = options.db ?? getDb();
  const [row] = await db
    .select()
    .from(agentClients)
    .where(eq(agentClients.id, id))
    .limit(1);
  return row ? toClient(row) : null;
}

/** Records that a person allowed this client. */
export async function touchClient(
  id: string,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  const db = options.db ?? getDb();
  await db
    .update(agentClients)
    .set({ lastUsedAt: options.now ?? new Date() })
    .where(eq(agentClients.id, id));
}

/**
 * Removes registrations nobody came of.
 *
 * Unauthenticated, so they accumulate: every connector add registers afresh,
 * and so does anything that merely probes the endpoint. A client no person ever
 * allowed, and that holds no grant, has done nothing and will do nothing — its
 * owner would register again.
 */
export async function pruneUnusedClients(
  options: { db?: Database; now?: Date } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const cutoff = new Date(
    (options.now ?? new Date()).getTime() - UNUSED_CLIENT_TTL_SECONDS * 1000,
  );
  const removed = await db
    .delete(agentClients)
    .where(
      and(
        isNull(agentClients.lastUsedAt),
        lt(agentClients.createdAt, cutoff),
        sql`NOT EXISTS (SELECT 1 FROM ${agentGrants} WHERE ${agentGrants.clientId} = ${agentClients.id})`,
      ),
    )
    .returning({ id: agentClients.id });
  return removed.length;
}

function toClient(row: typeof agentClients.$inferSelect): RegisteredClient {
  return {
    id: row.id,
    name: row.name,
    redirectUris: row.redirectUris,
    createdAt: row.createdAt,
  };
}
