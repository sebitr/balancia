import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { getDb } from "@/lib/db/client";
import {
  agentClients,
  agentCodes,
  agentGrants,
  agentRefreshHistory,
  groups,
  users,
} from "@/lib/db/schema";
import {
  approveAuthorization,
  AuthorizationChoiceError,
  denialRedirect,
  parseAuthorizationRequest,
} from "@/modules/agent-access/authorization";
import {
  capUnusedClients,
  getClient,
  pruneUnusedClients,
  registerClient,
} from "@/modules/agent-access/clients";
import {
  MAX_LIVE_GRANTS,
  MAX_UNUSED_CLIENTS,
} from "@/modules/agent-access/constants";
import { OAuthError } from "@/modules/agent-access/errors";
import {
  disconnect,
  disconnectAll,
  exchangeAuthorizationCode,
  listConnections,
  pruneAgentAccess,
  refreshGrant,
  resolveAccessToken,
  revokeByToken,
} from "@/modules/agent-access/grants";
import { challengeFor } from "@/modules/agent-access/pkce";
import { revokeAllApiTokensForUser } from "@/modules/api-tokens/service";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * The authorization server, through its services: from a stranger's
 * registration to a token that opens `/mcp`, and every way it should refuse on
 * the way.
 *
 * The routes are in `agent-access-routes.test.ts`; this file is the part that
 * is true whatever they look like, and the part with the money in it. Each
 * refusal below is a way for a code or a token to end up with somebody it was
 * not meant for.
 */

const ORIGIN = "http://localhost:3000";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

function pkce() {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: challengeFor(verifier) };
}

function authorizeQuery(
  clientId: string,
  challenge: string,
  extra: Record<string, string> = {},
): URLSearchParams {
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: REDIRECT,
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "abc123",
    ...extra,
  });
}

async function register(name = "Claude", redirectUris = [REDIRECT]) {
  return registerClient({ client_name: name, redirect_uris: redirectUris });
}

/** A signed-in person says yes to a fresh client; returns what the client holds. */
async function connect(
  options: {
    scope?: "read" | "write";
    groupId?: string | null;
    asks?: Record<string, string>;
    now?: Date;
  } = {},
) {
  const person = await createTestUser({ name: "Ada" });
  return { person, ...(await connectFor(person.userId, options)) };
}

async function connectFor(
  userId: string,
  options: {
    scope?: "read" | "write";
    groupId?: string | null;
    asks?: Record<string, string>;
    now?: Date;
    client?: Awaited<ReturnType<typeof register>>;
  } = {},
) {
  const client = options.client ?? (await register());
  const { verifier, challenge } = pkce();
  const parsed = await parseAuthorizationRequest(
    authorizeQuery(client.id, challenge, options.asks),
    ORIGIN,
  );
  if (parsed.kind !== "ok") throw new Error(`unexpected ${parsed.kind}`);

  const location = await approveAuthorization(
    parsed.request,
    userId,
    { scope: options.scope ?? "write", groupId: options.groupId ?? null },
    ORIGIN,
    { now: options.now },
  );
  const code = new URL(location).searchParams.get("code")!;
  const redirectUri = parsed.request.redirectUri;
  const exchange = () =>
    exchangeAuthorizationCode(
      { code, clientId: client.id, redirectUri, codeVerifier: verifier },
      ORIGIN,
      { now: options.now },
    );
  return { client, verifier, challenge, code, redirectUri, location, exchange };
}

async function rejection(promise: Promise<unknown>): Promise<OAuthError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof OAuthError) return error;
    throw error;
  }
  throw new Error("expected an OAuthError, but the call succeeded");
}

describe("registering a client", () => {
  it("stores what it said, and sanitizes the name a person will read", async () => {
    const client = await registerClient({
      client_name: `  Claude\n\n   Desktop  `,
      redirect_uris: [REDIRECT, REDIRECT],
    });

    expect(client.name).toBe("Claude Desktop");
    // The same address twice is one address.
    expect(client.redirectUris).toEqual([REDIRECT]);
    expect(await getClient(client.id)).toMatchObject({
      name: "Claude Desktop",
    });
  });

  it("calls an application with no name by that, rather than by nothing", async () => {
    const client = await registerClient({ redirect_uris: [REDIRECT] });
    expect(client.name).toBe("Unnamed application");
  });

  it("refuses an address that could send a code somewhere it should not go", async () => {
    for (const bad of [
      "http://evil.example/cb",
      "javascript:alert(1)",
      "https://evil.example/cb#frag",
    ]) {
      const error = await rejection(
        registerClient({ client_name: "x", redirect_uris: [bad] }),
      );
      expect(error.code).toBe("invalid_redirect_uri");
    }
    expect(await getDb().select().from(agentClients)).toHaveLength(0);
  });

  it("refuses a registration with no address, or with too many", async () => {
    for (const body of [
      {},
      { redirect_uris: [] },
      {
        redirect_uris: Array.from(
          { length: 6 },
          (_, i) => `https://e${i}.example/cb`,
        ),
      },
      { redirect_uris: "https://example.com/cb" },
      null,
      "text",
    ]) {
      expect((await rejection(registerClient(body))).code).toBe(
        "invalid_client_metadata",
      );
    }
  });

  it("knows no client for an id that is not one", async () => {
    expect(await getClient("not-a-uuid")).toBeNull();
    expect(await getClient("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("reading an authorization request", () => {
  it("accepts a well-formed one and remembers what it asked for", async () => {
    const client = await register();
    const { challenge } = pkce();
    const parsed = await parseAuthorizationRequest(
      authorizeQuery(client.id, challenge, {
        scope: "balancia:read",
        resource: `${ORIGIN}/mcp`,
      }),
      ORIGIN,
    );

    expect(parsed).toMatchObject({
      kind: "ok",
      request: {
        clientId: client.id,
        clientName: "Claude",
        redirectUri: REDIRECT,
        state: "abc123",
        maxScope: "read",
        resource: `${ORIGIN}/mcp`,
      },
    });
  });

  it("asks for everything when it names no scope", async () => {
    const client = await register();
    const parsed = await parseAuthorizationRequest(
      authorizeQuery(client.id, pkce().challenge),
      ORIGIN,
    );
    expect(parsed).toMatchObject({ request: { maxScope: "write" } });
  });

  it("never redirects to an address it does not trust", async () => {
    const client = await register();
    const { challenge } = pkce();

    const unknown = await parseAuthorizationRequest(
      authorizeQuery("00000000-0000-4000-8000-000000000000", challenge),
      ORIGIN,
    );
    expect(unknown).toEqual({ kind: "untrusted", reason: "unknownClient" });

    const noClient = await parseAuthorizationRequest(
      new URLSearchParams({ response_type: "code" }),
      ORIGIN,
    );
    expect(noClient).toEqual({ kind: "untrusted", reason: "unknownClient" });

    for (const redirect of [
      "https://evil.example/cb",
      `${REDIRECT}/`,
      `${REDIRECT}?x=1`,
    ]) {
      const parsed = await parseAuthorizationRequest(
        authorizeQuery(client.id, challenge, { redirect_uri: redirect }),
        ORIGIN,
      );
      expect(parsed).toEqual({ kind: "untrusted", reason: "badRedirect" });
    }

    const missing = new URLSearchParams(authorizeQuery(client.id, challenge));
    missing.delete("redirect_uri");
    expect(await parseAuthorizationRequest(missing, ORIGIN)).toEqual({
      kind: "untrusted",
      reason: "badRedirect",
    });
  });

  it("answers a fault in the rest of the request to the registered address", async () => {
    const client = await register();
    const { challenge } = pkce();
    const faults: [string, Record<string, string>, string][] = [
      [
        "a response type that is not code",
        { response_type: "token" },
        "unsupported_response_type",
      ],
      ["no PKCE challenge", { code_challenge: "" }, "invalid_request"],
      ["a malformed challenge", { code_challenge: "short" }, "invalid_request"],
      [
        "the plain method",
        { code_challenge_method: "plain" },
        "invalid_request",
      ],
      [
        "a resource that is not this server",
        { resource: "https://evil.example/mcp" },
        "invalid_target",
      ],
    ];

    for (const [, change, error] of faults) {
      const parsed = await parseAuthorizationRequest(
        authorizeQuery(client.id, challenge, change),
        ORIGIN,
      );
      expect(parsed).toMatchObject({
        kind: "refused",
        redirectUri: REDIRECT,
        state: "abc123",
        error,
      });
    }
  });

  it("refuses a parameter that appears twice instead of choosing between them", async () => {
    const client = await register();
    const query = authorizeQuery(client.id, pkce().challenge);
    query.append("scope", "balancia:read");
    query.append("scope", "balancia:write");

    expect(await parseAuthorizationRequest(query, ORIGIN)).toMatchObject({
      kind: "refused",
      error: "invalid_request",
    });
  });

  it("says no to the client as access_denied, with its state and the issuer", async () => {
    const client = await register();
    const parsed = await parseAuthorizationRequest(
      authorizeQuery(client.id, pkce().challenge),
      ORIGIN,
    );
    if (parsed.kind !== "ok") throw new Error("setup");

    const url = new URL(denialRedirect(parsed.request, ORIGIN));
    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("error")).toBe("access_denied");
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
  });
});

describe("saying yes", () => {
  it("answers with a code, the client's state and the issuer", async () => {
    const { location } = await connect();
    const url = new URL(location);

    expect(url.origin + url.pathname).toBe(REDIRECT);
    expect(url.searchParams.get("code")).toHaveLength(43);
    expect(url.searchParams.get("state")).toBe("abc123");
    expect(url.searchParams.get("iss")).toBe(ORIGIN);
  });

  it("stores the code only as a hash", async () => {
    const { code } = await connect();
    const rows = await getDb().select().from(agentCodes);

    expect(rows).toHaveLength(1);
    expect(rows[0]!.codeHash).not.toBe(code);
    expect(rows[0]!.codeHash).toHaveLength(64);
  });

  it("cannot grant more than the application asked for", async () => {
    const { exchange } = await connect({
      scope: "write",
      asks: { scope: "balancia:read" },
    });
    expect((await exchange()).scope).toBe("read");
  });

  it("lets the person grant less than was asked", async () => {
    const { exchange } = await connect({ scope: "read" });
    expect((await exchange()).scope).toBe("read");
  });

  it("refuses to pin to a group the person is not in", async () => {
    const stranger = await createTestUser({ name: "Zed" });
    const theirs = await createTestGroup(stranger, { name: "Private" });
    const person = await createTestUser({ name: "Ada" });

    await expect(
      connectFor(person.userId, { groupId: theirs.groupId }),
    ).rejects.toMatchObject({ reason: "notYourGroup" });
    expect(await getDb().select().from(agentCodes)).toHaveLength(0);
  });

  it("stops at the number of connections one account can hold", async () => {
    const person = await createTestUser();
    for (let i = 0; i < MAX_LIVE_GRANTS; i += 1) {
      const { exchange } = await connectFor(person.userId);
      await exchange();
    }

    const error = await connectFor(person.userId).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthorizationChoiceError);
    expect((error as AuthorizationChoiceError).reason).toBe("tooMany");
  });
});

describe("exchanging a code", () => {
  it("hands over tokens that identify the person and what they allowed", async () => {
    const { person, exchange } = await connect({ scope: "write" });
    const tokens = await exchange();

    expect(tokens.accessToken).toMatch(/^bla_/);
    expect(tokens.refreshToken).toMatch(/^blr_/);
    expect(tokens.expiresIn).toBe(3600);
    expect(tokens.scope).toBe("write");

    expect(await resolveAccessToken(tokens.accessToken)).toMatchObject({
      userId: person.userId,
      email: person.email,
      scope: "write",
      groupId: null,
      clientName: "Claude",
    });
  });

  it("keeps the tokens only as hashes", async () => {
    const { exchange } = await connect();
    const tokens = await exchange();
    const [grant] = await getDb().select().from(agentGrants);

    for (const secret of [tokens.accessToken, tokens.refreshToken]) {
      expect(JSON.stringify(grant)).not.toContain(secret);
    }
    expect(grant!.accessTokenHash).toHaveLength(64);
    expect(grant!.refreshTokenHash).toHaveLength(64);
  });

  it("carries a group pin onto the token", async () => {
    const person = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(person, { name: "Lisbon" });
    const { exchange } = await connectFor(person.userId, {
      groupId: group.groupId,
    });

    expect(
      await resolveAccessToken((await exchange()).accessToken),
    ).toMatchObject({ groupId: group.groupId });
  });

  it("refuses the wrong verifier, and does not burn the code for it", async () => {
    const { code, client, redirectUri, exchange } = await connect();

    const wrong = await rejection(
      exchangeAuthorizationCode(
        {
          code,
          clientId: client.id,
          redirectUri,
          codeVerifier: randomBytes(32).toString("base64url"),
        },
        ORIGIN,
      ),
    );
    expect(wrong.code).toBe("invalid_grant");

    // Somebody who intercepted the code and cannot pass PKCE must not be able
    // to spend it out from under the application that can.
    expect((await exchange()).accessToken).toMatch(/^bla_/);
  });

  it("refuses a different redirect address than the request named", async () => {
    const { code, client, verifier } = await connect();
    const error = await rejection(
      exchangeAuthorizationCode(
        {
          code,
          clientId: client.id,
          redirectUri: "https://claude.ai/api/mcp/other",
          codeVerifier: verifier,
        },
        ORIGIN,
      ),
    );
    expect(error.code).toBe("invalid_grant");
  });

  it("refuses another client's attempt to spend it", async () => {
    const { code, redirectUri, verifier } = await connect();
    const other = await register("Other");
    const error = await rejection(
      exchangeAuthorizationCode(
        { code, clientId: other.id, redirectUri, codeVerifier: verifier },
        ORIGIN,
      ),
    );
    expect(error.code).toBe("invalid_grant");
  });

  it("refuses an unknown client in its own words", async () => {
    const { code, redirectUri, verifier } = await connect();
    const error = await rejection(
      exchangeAuthorizationCode(
        {
          code,
          clientId: "00000000-0000-4000-8000-000000000000",
          redirectUri,
          codeVerifier: verifier,
        },
        ORIGIN,
      ),
    );
    expect(error.code).toBe("invalid_client");
    expect(error.status).toBe(401);
  });

  it("refuses a code after its five minutes", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const flow = await connect({ now });
    const later = new Date(now.getTime() + 5 * 60 * 1000 + 1000);

    const error = await rejection(
      exchangeAuthorizationCode(
        {
          code: flow.code,
          clientId: flow.client.id,
          redirectUri: flow.redirectUri,
          codeVerifier: flow.verifier,
        },
        ORIGIN,
        { now: later },
      ),
    );
    expect(error.code).toBe("invalid_grant");
  });

  it("refuses a code that was never issued, and a malformed one, alike", async () => {
    const { client, redirectUri, verifier } = await connect();
    for (const code of [randomBytes(32).toString("base64url"), "short", ""]) {
      const error = await rejection(
        exchangeAuthorizationCode(
          { code, clientId: client.id, redirectUri, codeVerifier: verifier },
          ORIGIN,
        ),
      );
      expect(error.code).toBe("invalid_grant");
    }
  });

  it("refuses a resource that is not this server", async () => {
    const { code, client, redirectUri, verifier } = await connect();
    const error = await rejection(
      exchangeAuthorizationCode(
        {
          code,
          clientId: client.id,
          redirectUri,
          codeVerifier: verifier,
          resource: "https://evil.example/mcp",
        },
        ORIGIN,
      ),
    );
    expect(error.code).toBe("invalid_target");
  });

  it("ends the grant when a code is used a second time", async () => {
    const { exchange } = await connect();
    const first = await exchange();
    expect(await resolveAccessToken(first.accessToken)).not.toBeNull();

    expect((await rejection(exchange())).code).toBe("invalid_grant");
    // Whoever spent it first, the server cannot tell; what it made is ended.
    expect(await resolveAccessToken(first.accessToken)).toBeNull();
  });

  it("makes one grant when two exchanges race for one code, and ends it", async () => {
    const { exchange } = await connect();
    const results = await Promise.allSettled([exchange(), exchange()]);

    const winner = results.find((r) => r.status === "fulfilled");
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getDb().select().from(agentGrants)).toHaveLength(1);

    // The same position as a second use of a spent code, reached the other way
    // round: whoever won holds a grant that may not have been meant for them,
    // and the server cannot tell which of the two was the application.
    // (Not asserted for the sequential case twice — see the test above.)
    const tokens = (winner as PromiseFulfilledResult<{ accessToken: string }>)
      .value;
    expect(await resolveAccessToken(tokens.accessToken)).toBeNull();
  });

  it("refuses an account that has been disabled since", async () => {
    const { person, exchange } = await connect();
    await getDb()
      .update(users)
      .set({ disabledAt: new Date() })
      .where(eq(users.id, person.userId));

    expect((await rejection(exchange())).code).toBe("invalid_grant");
  });
});

describe("an access token", () => {
  it("stops working when it expires, and not before", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const { exchange } = await connect({ now });
    const { accessToken } = await exchange();

    expect(
      await resolveAccessToken(accessToken, {
        now: new Date(now.getTime() + 59 * 60 * 1000),
      }),
    ).not.toBeNull();
    expect(
      await resolveAccessToken(accessToken, {
        now: new Date(now.getTime() + 60 * 60 * 1000 + 1),
      }),
    ).toBeNull();
  });

  it("is not the same thing as an API key, a refresh token or garbage", async () => {
    const { exchange } = await connect();
    const { refreshToken } = await exchange();

    for (const bad of [
      refreshToken,
      "",
      "bla_",
      `blc_${"A".repeat(43)}`,
      "x",
    ]) {
      expect(await resolveAccessToken(bad)).toBeNull();
    }
  });

  it("stops working for an account that is disabled", async () => {
    const { person, exchange } = await connect();
    const { accessToken } = await exchange();
    await getDb()
      .update(users)
      .set({ disabledAt: new Date() })
      .where(eq(users.id, person.userId));

    expect(await resolveAccessToken(accessToken)).toBeNull();
  });

  it("stamps when it was last used, which makes a forgotten one visible", async () => {
    const { person, exchange } = await connect();
    const { accessToken } = await exchange();

    expect((await listConnections(person.userId))[0]!.lastUsedAt).toBeNull();
    await resolveAccessToken(accessToken);
    expect(
      (await listConnections(person.userId))[0]!.lastUsedAt,
    ).not.toBeNull();
  });
});

describe("refreshing", () => {
  const T0 = new Date("2026-10-08T12:00:00Z");
  const at = (seconds: number) => new Date(T0.getTime() + seconds * 1000);

  async function connected() {
    const flow = await connect({ now: T0 });
    const tokens = await flow.exchange();
    const refresh = (
      refreshToken: string,
      seconds: number,
      extra: { scope?: string; clientId?: string } = {},
    ) =>
      refreshGrant(
        {
          refreshToken,
          clientId: extra.clientId ?? flow.client.id,
          ...(extra.scope ? { scope: extra.scope } : {}),
        },
        ORIGIN,
        { now: at(seconds) },
      );
    return { ...flow, tokens, refresh };
  }

  it("replaces both tokens, and the old pair stops working", async () => {
    const { tokens, refresh } = await connected();
    const next = await refresh(tokens.refreshToken, 3000);

    expect(next.accessToken).not.toBe(tokens.accessToken);
    expect(next.refreshToken).not.toBe(tokens.refreshToken);
    expect(
      await resolveAccessToken(next.accessToken, { now: at(3001) }),
    ).not.toBeNull();
    expect(
      await resolveAccessToken(tokens.accessToken, { now: at(3001) }),
    ).toBeNull();
  });

  it("keeps what was granted: scope and pin survive a refresh", async () => {
    const person = await createTestUser();
    const group = await createTestGroup(person, { name: "Lisbon" });
    const flow = await connectFor(person.userId, {
      scope: "read",
      groupId: group.groupId,
      now: T0,
    });
    const tokens = await flow.exchange();
    const next = await refreshGrant(
      { refreshToken: tokens.refreshToken, clientId: flow.client.id },
      ORIGIN,
      { now: at(10) },
    );

    expect(next.scope).toBe("read");
    expect(
      await resolveAccessToken(next.accessToken, { now: at(11) }),
    ).toMatchObject({
      scope: "read",
      groupId: group.groupId,
    });
  });

  it("can ask for less than it has, never more", async () => {
    const flow = await connect({ scope: "read", now: T0 });
    const tokens = await flow.exchange();

    const error = await rejection(
      refreshGrant(
        {
          refreshToken: tokens.refreshToken,
          clientId: flow.client.id,
          scope: "balancia:read balancia:write",
        },
        ORIGIN,
        { now: at(10) },
      ),
    );
    expect(error.code).toBe("invalid_scope");
  });

  it("forgives the old token for a few seconds, because two requests can leave together", async () => {
    const { tokens, refresh, client } = await connected();
    const winner = await refresh(tokens.refreshToken, 100);

    const loser = await rejection(refresh(tokens.refreshToken, 105));
    expect(loser.code).toBe("invalid_grant");

    // The connection the winner holds is untouched.
    expect(
      await resolveAccessToken(winner.accessToken, { now: at(106) }),
    ).not.toBeNull();
    expect(
      (
        await refreshGrant(
          { refreshToken: winner.refreshToken, clientId: client.id },
          ORIGIN,
          { now: at(107) },
        )
      ).accessToken,
    ).toMatch(/^bla_/);
  });

  it("treats the old token coming back later as theft, and ends the grant", async () => {
    const { tokens, refresh } = await connected();
    const winner = await refresh(tokens.refreshToken, 100);

    const thief = await rejection(refresh(tokens.refreshToken, 100 + 11));
    expect(thief.code).toBe("invalid_grant");

    // The legitimate client's own tokens go with it: the server cannot know
    // which of the two it was talking to, and one reconnect is the price.
    expect(
      await resolveAccessToken(winner.accessToken, { now: at(112) }),
    ).toBeNull();
    await expect(refresh(winner.refreshToken, 113)).rejects.toMatchObject({
      code: "invalid_grant",
    });
  });

  it("treats a token that is two rotations old as theft just the same", async () => {
    // The thief steals R1 and refreshes straight away, and again, so that R1
    // is two rotations old: it matches neither the current token nor the one
    // before it. A server that remembers only the latest replaced token calls
    // the real client's R1, hours later, a plain invalid_grant — and the thief
    // keeps R3, sliding for ninety days, while the person reconnects as a
    // second grant and sees two of them.
    const { tokens, refresh, client } = await connected();
    const second = await refresh(tokens.refreshToken, 100);
    const third = await refresh(second.refreshToken, 101);

    const real = await rejection(refresh(tokens.refreshToken, 100 + 3600));
    expect(real.code).toBe("invalid_grant");

    // Ended: the thief's newest tokens go with it.
    expect(
      await resolveAccessToken(third.accessToken, { now: at(3700) }),
    ).toBeNull();
    await expect(
      refreshGrant(
        { refreshToken: third.refreshToken, clientId: client.id },
        ORIGIN,
        {
          now: at(3701),
        },
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
  });

  it("remembers every token it replaced, and only until each would have lapsed", async () => {
    const { tokens, refresh } = await connected();
    const second = await refresh(tokens.refreshToken, 100);
    await refresh(second.refreshToken, 101);

    expect(await getDb().select().from(agentRefreshHistory)).toHaveLength(2);

    const day = 24 * 60 * 60;
    await pruneAgentAccess({ now: at(91 * day) });
    // Both lapsed on their own by then: seeing either again proves nothing.
    expect(await getDb().select().from(agentRefreshHistory)).toHaveLength(0);
    // The grant itself carries on under the newest token.
    expect(await getDb().select().from(agentGrants)).toHaveLength(1);
  });

  it("makes one rotation when two refreshes race for one token", async () => {
    const { tokens, refresh } = await connected();
    const results = await Promise.allSettled([
      refresh(tokens.refreshToken, 100),
      refresh(tokens.refreshToken, 100),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("lives ninety days from the last use, and no longer", async () => {
    const { tokens, refresh } = await connected();
    const day = 24 * 60 * 60;

    await expect(refresh(tokens.refreshToken, 91 * day)).rejects.toMatchObject({
      code: "invalid_grant",
    });
  });

  it("slides: using it moves the ninety days forward", async () => {
    const { tokens, refresh } = await connected();
    const day = 24 * 60 * 60;
    const second = await refresh(tokens.refreshToken, 60 * day);

    // Day 120 is past 90 days from the start and inside 90 from the refresh.
    expect((await refresh(second.refreshToken, 120 * day)).accessToken).toMatch(
      /^bla_/,
    );
  });

  it("is refused to a client that does not own the grant", async () => {
    const { tokens, refresh } = await connected();
    const other = await register("Other");

    await expect(
      refresh(tokens.refreshToken, 10, { clientId: other.id }),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    // …and the owner's token was not spent by the attempt.
    expect((await refresh(tokens.refreshToken, 11)).accessToken).toMatch(
      /^bla_/,
    );
  });

  it("is refused for an access token or a made-up one", async () => {
    const { tokens, refresh } = await connected();
    for (const bad of [tokens.accessToken, `blr_${"A".repeat(43)}`, "", "x"]) {
      await expect(refresh(bad, 10)).rejects.toMatchObject({
        code: "invalid_grant",
      });
    }
  });
});

describe("ending a connection", () => {
  it("lets a person list their own connections, and only theirs", async () => {
    const mine = await connect();
    await mine.exchange();
    const theirs = await connect();
    await theirs.exchange();

    const listed = await listConnections(mine.person.userId);
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      clientName: "Claude",
      scope: "write",
      groupId: null,
    });
  });

  it("disconnects at once: neither token works afterwards", async () => {
    const { person, client, exchange } = await connect();
    const tokens = await exchange();
    const [connection] = await listConnections(person.userId);

    expect(await disconnect(person.userId, connection!.id)).toBe(true);
    expect(await resolveAccessToken(tokens.accessToken)).toBeNull();
    await expect(
      refreshGrant(
        { refreshToken: tokens.refreshToken, clientId: client.id },
        ORIGIN,
      ),
    ).rejects.toMatchObject({ code: "invalid_grant" });
    expect(await listConnections(person.userId)).toEqual([]);
  });

  it("will not disconnect somebody else's", async () => {
    const mine = await connect();
    const tokens = await mine.exchange();
    const stranger = await createTestUser();
    const [connection] = await listConnections(mine.person.userId);

    expect(await disconnect(stranger.userId, connection!.id)).toBe(false);
    expect(await resolveAccessToken(tokens.accessToken)).not.toBeNull();
  });

  it("is what the client asks for by revoking a token (RFC 7009)", async () => {
    const { client, exchange } = await connect();
    const tokens = await exchange();

    await revokeByToken(tokens.refreshToken, client.id);
    expect(await resolveAccessToken(tokens.accessToken)).toBeNull();
  });

  it("will not revoke another client's token, and says nothing about it", async () => {
    const { exchange } = await connect();
    const tokens = await exchange();
    const other = await register("Other");

    await revokeByToken(tokens.accessToken, other.id);
    expect(await resolveAccessToken(tokens.accessToken)).not.toBeNull();
    // A token that never existed is the same quiet nothing.
    await expect(
      revokeByToken("blr_nonsense", undefined),
    ).resolves.toBeUndefined();
  });

  it("goes with the keys when an account is taken back", async () => {
    // A password reset, an email change and the first proof of an address all
    // end every key, because minting one needs only a session the owner may
    // have ended. Allowing an assistant needs exactly the same.
    const { person, exchange } = await connect();
    const tokens = await exchange();

    expect(await revokeAllApiTokensForUser(person.userId)).toBe(1);
    expect(await resolveAccessToken(tokens.accessToken)).toBeNull();
    expect(await listConnections(person.userId)).toEqual([]);
  });

  it("takes a code nobody has exchanged yet away too, when an account is taken back", async () => {
    // "Allow" mints a code good for five minutes. Somebody holding a stolen
    // session could keep one ready, wait for the owner's password reset, and
    // exchange it afterwards for a fresh grant — which is what ending every
    // grant is meant to prevent.
    const person = await createTestUser();
    const flow = await connectFor(person.userId);

    await revokeAllApiTokensForUser(person.userId);

    expect((await rejection(flow.exchange())).code).toBe("invalid_grant");
    expect(await getDb().select().from(agentGrants)).toHaveLength(0);
  });

  it("disconnects every one an account has", async () => {
    const person = await createTestUser();
    const first = await connectFor(person.userId);
    const second = await connectFor(person.userId);
    const a = await first.exchange();
    const b = await second.exchange();

    expect(await disconnectAll(person.userId)).toBe(2);
    expect(await resolveAccessToken(a.accessToken)).toBeNull();
    expect(await resolveAccessToken(b.accessToken)).toBeNull();
  });

  it("goes when the group it was pinned to goes", async () => {
    const person = await createTestUser();
    const group = await createTestGroup(person, { name: "Lisbon" });
    const flow = await connectFor(person.userId, { groupId: group.groupId });
    await flow.exchange();

    await getDb().delete(groups).where(eq(groups.id, group.groupId));
    expect(await listConnections(person.userId)).toEqual([]);
  });
});

describe("housekeeping", () => {
  it("sweeps codes a day past their life and grants a month past their end", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const old = new Date(now.getTime() - 40 * 24 * 60 * 60 * 1000);

    // One that began and ended long ago, and one that is live now.
    const stale = await connect({ now: old });
    await stale.exchange();
    const [ended] = await listConnections(stale.person.userId, { now: old });
    await disconnect(stale.person.userId, ended!.id, { now: old });
    const fresh = await connect({ now });
    await fresh.exchange();

    const swept = await pruneAgentAccess({ now });
    expect(swept.codes).toBe(1);
    expect(swept.grants).toBe(1);
    expect(await getDb().select().from(agentGrants)).toHaveLength(1);
    expect(await getDb().select().from(agentCodes)).toHaveLength(1);
  });

  it("bounds the registrations nobody has allowed by dropping the oldest, and refuses nobody", async () => {
    const db = getDb();
    const base = new Date("2026-01-01T00:00:00Z").getTime();
    await db.insert(agentClients).values(
      Array.from({ length: MAX_UNUSED_CLIENTS + 3 }, (_, i) => ({
        name: `flood ${i}`,
        redirectUris: [REDIRECT],
        createdAt: new Date(base + i * 1000),
        // The very oldest was allowed once, and is not the flood's to evict.
        ...(i === 0 ? { lastUsedAt: new Date(base) } : {}),
      })),
    );

    expect(await capUnusedClients()).toBe(2);

    const names = (await db.select().from(agentClients)).map((c) => c.name);
    expect(names).toContain("flood 0");
    expect(names).not.toContain("flood 1");
    expect(names).not.toContain("flood 2");
    expect(names).toContain("flood 3");
    expect(names).toContain(`flood ${MAX_UNUSED_CLIENTS + 2}`);

    // And registering still works with the table full.
    expect((await register("Real")).name).toBe("Real");
  });

  it("removes registrations nobody allowed, and keeps the ones somebody did", async () => {
    const now = new Date("2026-10-08T12:00:00Z");
    const weekOld = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);

    const abandoned = await registerClient(
      { client_name: "Nobody", redirect_uris: [REDIRECT] },
      { now: weekOld },
    );
    const used = await register("Used");
    const flow = await connectFor((await createTestUser()).userId, {
      client: used,
    });
    await flow.exchange();
    await getDb()
      .update(agentClients)
      .set({ createdAt: weekOld, lastUsedAt: null })
      .where(eq(agentClients.id, used.id));
    const young = await register("Young");

    expect(await pruneUnusedClients({ now })).toBe(1);
    expect(await getClient(abandoned.id)).toBeNull();
    // A client that holds a grant stays however old, and a young one stays.
    expect(await getClient(used.id)).not.toBeNull();
    expect(await getClient(young.id)).not.toBeNull();
  });
});
