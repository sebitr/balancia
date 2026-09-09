import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { apiTokens } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import {
  createApiToken,
  listApiTokens,
  resolveApiToken,
  revokeApiToken,
} from "@/modules/api-tokens/service";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * A key, end to end, through the routes it is pointed at.
 *
 * The route handlers rather than the services, for the same reason
 * `join-link-access.test.ts` gives: the services take an actor and enforce
 * nothing about *how* that actor was proved. Everything this feature promises —
 * a read key refused a write, a pinned key refused another group, a revoked key
 * refused everything — lives in the resolver and in `authorizeGroup`, and a
 * test against the services would pass with the door standing open.
 *
 * The cookie path is mocked out entirely so that nothing here can pass by
 * accident: when `getCurrentActor` answers null and a request still succeeds,
 * the bearer header is the only thing that could have carried it.
 */

const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    cookieActor.value?.kind === "user" ? cookieActor.value : null,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

const expenses = await import("@/app/api/groups/[groupId]/expenses/route");
const groupsRoute = await import("@/app/api/groups/route");
const notifications = await import("@/app/api/notifications/route");

beforeEach(() => {
  cookieActor.value = null;
});

function context(groupId: string) {
  return { params: Promise.resolve({ groupId }) } as never;
}

function request(
  method: string,
  token: string | null,
  options: { body?: unknown; path?: string } = {},
): Request {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  // `null` sends no header at all; `""` sends a bare `Bearer`, which is a
  // client bug worth telling apart from having offered no key.
  if (token !== null) {
    headers.Authorization = token === "" ? "Bearer" : `Bearer ${token}`;
  }
  return new Request(
    `http://localhost${options.path ?? "/api/groups/x/expenses"}`,
    {
      method,
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    },
  );
}

/** The smallest expense `expenseInputSchema` will accept. */
function expenseBody(participantId: string) {
  return {
    description: "Dinner",
    amount: "2500",
    currency: "EUR",
    expenseDate: "2026-09-01",
    payers: [{ participantId, amount: "2500" }],
    splitMethod: "equal",
    splitEntries: [{ participantId }],
  };
}

async function setup(scope: "read" | "write", pinned = false) {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, { name: "Lisbon" });
  const other = await createTestGroup(owner, { name: "Flat" });
  const { token } = await createApiToken(owner.userId, {
    name: `${scope} key`,
    scope,
    groupId: pinned ? group.groupId : null,
  });
  return { owner, group, other, token };
}

describe("minting and revoking", () => {
  it("hands over the secret once and stores only its hash", async () => {
    const owner = await createTestUser();
    const { token, record } = await createApiToken(owner.userId, {
      name: "Kitchen tablet",
      scope: "read",
    });

    const [row] = await getDb()
      .select()
      .from(apiTokens)
      .where(eq(apiTokens.id, record.id));

    expect(row!.tokenHash).not.toBe(token);
    expect(row!.tokenHash).toHaveLength(64);
    expect(row!.prefix).toBe(token.slice(0, 12));
    // The whole point of `prefix`: enough to name the key in a list, nothing
    // like enough to be one.
    expect(token.startsWith(row!.prefix)).toBe(true);
    expect(row!.lastUsedAt).toBeNull();
  });

  it("stamps lastUsedAt, which is what makes a stale key visible", async () => {
    const owner = await createTestUser();
    const { token, record } = await createApiToken(owner.userId, {
      name: "Cron",
      scope: "read",
    });

    expect((await listApiTokens(owner.userId))[0]!.lastUsedAt).toBeNull();
    await resolveApiToken(token);
    expect(
      (await listApiTokens(owner.userId)).find((t) => t.id === record.id)!
        .lastUsedAt,
    ).not.toBeNull();
  });

  it("refuses a revoked key, and leaves it out of the list", async () => {
    const owner = await createTestUser();
    const { token, record } = await createApiToken(owner.userId, {
      name: "Old",
      scope: "write",
    });

    expect(await resolveApiToken(token)).not.toBeNull();
    expect(await revokeApiToken(owner.userId, record.id)).toBe(true);
    expect(await resolveApiToken(token)).toBeNull();
    expect(await listApiTokens(owner.userId)).toEqual([]);
  });

  it("will not let one account revoke another's key", async () => {
    const owner = await createTestUser({ name: "Ada" });
    const stranger = await createTestUser({ name: "Mallory" });
    const { token, record } = await createApiToken(owner.userId, {
      name: "Mine",
      scope: "read",
    });

    // Indistinguishable from a made-up id, which is the point: the answer must
    // not say whether that key exists.
    expect(await revokeApiToken(stranger.userId, record.id)).toBe(false);
    expect(await revokeApiToken(stranger.userId, randomUUID())).toBe(false);
    expect(await resolveApiToken(token)).not.toBeNull();
  });
});

describe("a key on a route", () => {
  it("reads a group it may read, with no cookie anywhere", async () => {
    const { group, token } = await setup("read");

    const response = await expenses.GET(
      request("GET", token),
      context(group.groupId),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ expenses: [] });
  });

  it("refuses a read key on a write", async () => {
    const { group, token } = await setup("read");

    const response = await expenses.POST(
      request("POST", token, {
        body: expenseBody(group.ownerParticipantId),
      }),
      context(group.groupId),
    );

    // 403 rather than the 404 an authorization failure gets: nothing about the
    // group is being disclosed, and the holder needs to know it is the *key*
    // that is wrong in order to mint a better one.
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("read-only"),
    });
  });

  it("lets a write key write", async () => {
    const { group, token } = await setup("write");

    const response = await expenses.POST(
      request("POST", token, {
        body: expenseBody(group.ownerParticipantId),
      }),
      context(group.groupId),
    );

    expect(response.status).toBe(201);
  });

  it("refuses a pinned key on another group", async () => {
    const { group, other, token } = await setup("write", true);

    expect(
      (await expenses.GET(request("GET", token), context(group.groupId)))
        .status,
    ).toBe(200);

    const response = await expenses.GET(
      request("GET", token),
      context(other.groupId),
    );

    // 404, not 403: this one *is* about a group, and a pinned key must not be
    // usable to find out which group ids exist. Same answer as a group that is
    // not there at all.
    expect(response.status).toBe(404);
  });

  it("refuses a pinned key where there is no group to pin it to", async () => {
    const { token } = await setup("read", true);

    // The home overview spans every group the account is in. There is nothing
    // here for the pin to be checked against, so it would silently widen.
    const response = await groupsRoute.GET(
      request("GET", token, { path: "/api/groups" }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      error: expect.stringContaining("pinned"),
    });
  });

  it("lets a pinned key reach a route that reads nothing", async () => {
    const { token } = await setup("write", true);

    // `/api/parse` names no group, so the pin cannot be checked against
    // anything — and does not need to be. It answers out of the sentence in
    // the request body and touches no row, so there is nothing for a pin to
    // widen to. Refusing it would leave the share-sheet Shortcut this feature
    // exists for able to file the expense and unable to read the sentence.
    const parse = await import("@/app/api/parse/route");
    const response = await parse.POST(
      request("POST", token, {
        path: "/api/parse",
        body: { text: "Dinner 25 EUR" },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ amountText: "25" });
  });

  it("lets an unpinned key read across groups", async () => {
    const { token } = await setup("read");

    const response = await groupsRoute.GET(
      request("GET", token, { path: "/api/groups" }),
    );

    expect(response.status).toBe(200);
  });

  it("refuses a revoked key on a route", async () => {
    const owner = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(owner);
    const { token, record } = await createApiToken(owner.userId, {
      name: "Old",
      scope: "write",
    });
    await revokeApiToken(owner.userId, record.id);

    const response = await expenses.GET(
      request("GET", token),
      context(group.groupId),
    );

    expect(response.status).toBe(401);
  });

  it.each([
    ["gibberish", "blc_not-a-real-key"],
    ["a session-shaped token", "a".repeat(43)],
    ["an empty bearer", ""],
  ])("refuses %s rather than falling back to the cookie", async (_, value) => {
    const owner = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(owner);
    // A live cookie session on the very same request. Once `Bearer` has been
    // written, the key is the credential and a bad one is refused as a key —
    // never quietly upgraded to whatever session is riding along.
    cookieActor.value = owner;

    const response = await expenses.GET(
      request("GET", value),
      context(group.groupId),
    );

    expect(response.status).toBe(401);
  });

  it("leaves the cookie path alone when no bearer is offered", async () => {
    const owner = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(owner);
    cookieActor.value = owner;

    const response = await expenses.GET(
      request("GET", null),
      context(group.groupId),
    );

    expect(response.status).toBe(200);
  });

  it("reaches a route that is about the account, and is refused", async () => {
    const { token } = await setup("write");

    // `/api/notifications` is an ordinary read for an unpinned key…
    const allowed = await notifications.GET(
      request("GET", token, { path: "/api/notifications" }),
    );
    expect(allowed.status).toBe(200);

    // …but the account routes are unreachable by construction. `GET
    // /api/profile` does not even take the request — there is nowhere for a
    // bearer header to be read from — so it resolves the cookie, finds none,
    // and answers 401. That signature is the guarantee.
    const profile = await import("@/app/api/profile/route");
    const refused = await profile.GET();
    expect(refused.status).toBe(401);
  });
});
