import "server-only";
import { and, count, eq, gt, isNull } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { agentCodes, agentGrants } from "@/lib/db/schema";
import { listGroupsForUser } from "@/modules/groups/service";
import type { TokenScope } from "@/modules/api-tokens/scope";
import { getClient, touchClient } from "./clients";
import {
  AUTHORIZATION_CODE_TTL_SECONDS,
  CODE_CHALLENGE_METHOD,
  MAX_LIVE_GRANTS,
} from "./constants";
import type { OAuthErrorCode } from "./errors";
import { isThisResource, mcpResourceUrl } from "./metadata";
import { isValidCodeChallenge } from "./pkce";
import { redirectUriMatches, withParameters } from "./redirect-uri";
import { covers, requestedScope } from "./scopes";
import { generateAuthorizationCode } from "./tokens";

/**
 * The authorization endpoint's two halves: reading a request, and answering it.
 *
 * Reading comes first and is strict, in the order RFC 6749 §4.1.2.1 sets out,
 * because the order decides what happens to a person. A request whose client
 * or redirect address cannot be trusted is never answered by redirecting —
 * that is the open redirect the whole specification is arranged to prevent — so
 * it ends on a page that says so. Every other fault is a real answer, sent to
 * the address the client registered, with `error` in it.
 */

/** A request that has passed every check except the person's say-so. */
export interface AuthorizationRequest {
  readonly clientId: string;
  readonly clientName: string;
  /** Exactly as the request named it; the code is bound to this string. */
  readonly redirectUri: string;
  readonly state: string | undefined;
  readonly codeChallenge: string;
  /** The most the client asked for. The person can grant less. */
  readonly maxScope: TokenScope;
  readonly resource: string | undefined;
}

export type AuthorizationParse =
  | { readonly kind: "ok"; readonly request: AuthorizationRequest }
  /** The client or its address cannot be trusted: say so, redirect nowhere. */
  | {
      readonly kind: "untrusted";
      readonly reason: "unknownClient" | "badRedirect";
    }
  /** The client is known; the fault is in the rest, and goes back to it. */
  | {
      readonly kind: "refused";
      readonly redirectUri: string;
      readonly state: string | undefined;
      readonly error: OAuthErrorCode;
      readonly description: string;
    };

const STATE_MAX_LENGTH = 1024;

/**
 * What `once` answers for a parameter that appears twice. RFC 6749 §3.1 says
 * a request parameter must not be repeated, and a server that quietly takes
 * the first or the last has picked a winner between two values somebody went
 * out of their way to send.
 */
const REPEATED = Symbol("repeated");

/** Reads the authorization request out of a query string. */
export async function parseAuthorizationRequest(
  search: URLSearchParams,
  origin: string,
  options: { db?: Database } = {},
): Promise<AuthorizationParse> {
  const once = (name: string): string | undefined | typeof REPEATED => {
    const all = search.getAll(name);
    return all.length > 1 ? REPEATED : all[0];
  };

  const clientId = once("client_id");
  if (typeof clientId !== "string") {
    return { kind: "untrusted", reason: "unknownClient" };
  }
  const client = await getClient(clientId, options);
  if (!client) return { kind: "untrusted", reason: "unknownClient" };

  const redirectUri = once("redirect_uri");
  if (
    typeof redirectUri !== "string" ||
    !redirectUriMatches(client.redirectUris, redirectUri)
  ) {
    return { kind: "untrusted", reason: "badRedirect" };
  }

  const rawState = once("state");
  const state =
    typeof rawState === "string" && rawState.length <= STATE_MAX_LENGTH
      ? rawState
      : undefined;
  const refuse = (error: OAuthErrorCode, description: string) =>
    ({
      kind: "refused",
      redirectUri,
      state,
      error,
      description,
    }) as const;

  if (rawState === REPEATED || (rawState && state === undefined)) {
    return refuse("invalid_request", "state is repeated or too long.");
  }

  const responseType = once("response_type");
  if (responseType === REPEATED) {
    return refuse("invalid_request", "response_type is repeated.");
  }
  if (responseType !== "code") {
    return refuse(
      "unsupported_response_type",
      "Only response_type=code is supported.",
    );
  }

  const challenge = once("code_challenge");
  const method = once("code_challenge_method");
  if (
    challenge === REPEATED ||
    method === REPEATED ||
    !isValidCodeChallenge(challenge)
  ) {
    return refuse(
      "invalid_request",
      "A code_challenge is required (PKCE, S256).",
    );
  }
  if (method !== CODE_CHALLENGE_METHOD) {
    return refuse(
      "invalid_request",
      `code_challenge_method must be ${CODE_CHALLENGE_METHOD}.`,
    );
  }

  const resource = once("resource");
  if (resource === REPEATED) {
    return refuse("invalid_target", "resource is repeated.");
  }
  if (resource !== undefined && !isThisResource(resource, origin)) {
    return refuse(
      "invalid_target",
      `This server only issues access for ${mcpResourceUrl(origin)}.`,
    );
  }

  const scope = once("scope");
  if (scope === REPEATED) {
    return refuse("invalid_request", "scope is repeated.");
  }

  return {
    kind: "ok",
    request: {
      clientId: client.id,
      clientName: client.name,
      redirectUri,
      state,
      codeChallenge: challenge,
      maxScope: requestedScope(scope),
      resource,
    },
  };
}

/** The address a refusal is sent to. */
export function refusalRedirect(
  refusal: Extract<AuthorizationParse, { kind: "refused" }>,
  origin: string,
): string {
  return withParameters(refusal.redirectUri, {
    error: refusal.error,
    error_description: refusal.description,
    state: refusal.state,
    iss: origin,
  });
}

/** "No." — sent to the client as `access_denied`, which it can show as such. */
export function denialRedirect(
  request: AuthorizationRequest,
  origin: string,
): string {
  return withParameters(request.redirectUri, {
    error: "access_denied",
    error_description: "The user declined.",
    state: request.state,
    iss: origin,
  });
}

export class AuthorizationChoiceError extends Error {
  readonly reason: "tooMany" | "notYourGroup";
  constructor(reason: "tooMany" | "notYourGroup") {
    super(reason);
    this.name = "AuthorizationChoiceError";
    this.reason = reason;
  }
}

/**
 * "Yes." — records what was agreed as a code and returns where to send it.
 *
 * The person chose two things on the screen, and both are checked here as
 * though the screen did not exist: the scope may not exceed what the client
 * asked for, and a group may only be one the account is in. Neither check is
 * about trust in the person; both are about the form being a thing anybody can
 * post to.
 */
export async function approveAuthorization(
  request: AuthorizationRequest,
  userId: string,
  choice: { readonly scope: TokenScope; readonly groupId: string | null },
  origin: string,
  options: { db?: Database; now?: Date } = {},
): Promise<string> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const scope = covers(request.maxScope, choice.scope)
    ? choice.scope
    : request.maxScope;

  if (choice.groupId !== null) {
    const groups = await listGroupsForUser(userId, { db });
    if (!groups.some((group) => group.id === choice.groupId)) {
      throw new AuthorizationChoiceError("notYourGroup");
    }
  }

  const [live] = await db
    .select({ n: count() })
    .from(agentGrants)
    .where(
      and(
        eq(agentGrants.userId, userId),
        isNull(agentGrants.revokedAt),
        gt(agentGrants.refreshExpiresAt, now),
      ),
    );
  if ((live?.n ?? 0) >= MAX_LIVE_GRANTS) {
    throw new AuthorizationChoiceError("tooMany");
  }

  const code = generateAuthorizationCode();
  await db.insert(agentCodes).values({
    codeHash: code.hash,
    clientId: request.clientId,
    userId,
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    scope,
    groupId: choice.groupId,
    createdAt: now,
    expiresAt: new Date(now.getTime() + AUTHORIZATION_CODE_TTL_SECONDS * 1000),
  });
  await touchClient(request.clientId, { db, now });

  return withParameters(request.redirectUri, {
    code: code.raw,
    state: request.state,
    iss: origin,
  });
}
