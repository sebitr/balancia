import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  API_ROUTES,
  decideScope,
  refusalMessage,
  scopeForMethod,
  scopeSatisfies,
  type TokenRefusal,
} from "./scope";
import {
  API_TOKEN_PREFIX,
  generateApiToken,
  hashToken,
  isWellFormedApiToken,
  isWellFormedToken,
} from "@/lib/security/tokens";

/**
 * What a key may reach, and what it is made of.
 *
 * Both halves are pure, which is the point of putting them here rather than
 * behind a request: every refusal in the feature is a row in a table below,
 * not a scenario somebody has to build a group and a session for. The
 * integration test proves the resolver spends these answers; this one proves
 * the answers are right.
 */

describe("the token's shape on the wire", () => {
  it("announces itself, so a leaked one is greppable", () => {
    const token = generateApiToken();
    expect(token.raw.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(isWellFormedApiToken(token.raw)).toBe(true);
  });

  it("keeps a prefix that names a key without being one", () => {
    const token = generateApiToken();
    expect(token.prefix).toBe(token.raw.slice(0, 12));
    expect(token.prefix.startsWith("blc_")).toBe(true);
    // The eight characters after `blc_` are a hundredth of the secret. What
    // matters is that the rest never leaves: the row keeps a hash, and the
    // prefix is not enough to reconstitute anything.
    expect(token.raw.length).toBeGreaterThan(token.prefix.length + 30);
    expect(token.hash).toBe(hashToken(token.raw));
    expect(token.hash).not.toContain(token.raw);
  });

  it("will not accept a session token as a bearer", () => {
    // The direction that matters. `resolveApiToken` is reached from an
    // attacker-supplied header, so it must not take anything that was minted
    // for another purpose — a session cookie, a join link, a guest invitation,
    // all of which are bare base64url.
    const bare = generateApiToken().raw.slice(API_TOKEN_PREFIX.length);
    expect(isWellFormedToken(bare)).toBe(true);
    expect(isWellFormedApiToken(bare)).toBe(false);
  });

  it("is shaped like a session token to the shared predicate, harmlessly", () => {
    // `blc_` is itself valid base64url, so the shared predicate accepts an API
    // key's shape — and it is deliberately not tightened to reject the prefix.
    // A minted *session* token has a one-in-sixteen-million chance of starting
    // `blc_` on its own, and refusing that one would sign somebody out for no
    // reason. Nothing rests on the shapes being disjoint: every caller of the
    // shared predicate uses it as a gate before a hash lookup in one named
    // table, so an API key offered as a session cookie costs a query that
    // finds nothing. The tables are the guard, not the regex.
    expect(isWellFormedToken(generateApiToken().raw)).toBe(true);
  });

  it.each([
    ["", "empty"],
    ["blc_", "the prefix and nothing else"],
    ["blc_tooshort", "under the length floor"],
    [`blc_${"a".repeat(65)}`, "over the length ceiling"],
    [`blc_${"a".repeat(43)}!`, "a character outside base64url"],
    [`BLC_${"a".repeat(43)}`, "the prefix miscased"],
    [` blc_${"a".repeat(43)}`, "padded with whitespace"],
  ])("refuses %j (%s)", (candidate) => {
    expect(isWellFormedApiToken(candidate)).toBe(false);
  });
});

describe("scope, per method", () => {
  it.each([
    ["GET", "read"],
    ["HEAD", "read"],
    ["POST", "write"],
    ["PATCH", "write"],
    ["PUT", "write"],
    ["DELETE", "write"],
  ])("%s needs %s", (method, expected) => {
    expect(scopeForMethod(method)).toBe(expected);
  });

  it.each([
    ["write", "write", true],
    ["write", "read", true],
    ["read", "read", true],
    ["read", "write", false],
  ] as const)("a %s key on a %s route: %s", (held, needed, allowed) => {
    expect(scopeSatisfies(held, needed)).toBe(allowed);
  });
});

describe("what a key may reach", () => {
  it.each([
    // The money, which is what a key is for.
    ["/api/groups/[groupId]/expenses", "GET", "read"],
    ["/api/groups/[groupId]/expenses", "POST", "write"],
    ["/api/groups/[groupId]/expenses/[expenseId]", "PATCH", "write"],
    ["/api/groups/[groupId]/expenses/[expenseId]", "DELETE", "write"],
    ["/api/groups/[groupId]/settlements", "POST", "write"],
    ["/api/groups/[groupId]/settle-up", "GET", "read"],
    ["/api/groups/[groupId]/stats", "GET", "read"],
    ["/api/groups/[groupId]/transactions", "GET", "read"],
    ["/api/groups/[groupId]/attachments", "POST", "write"],
    ["/api/groups", "GET", "read"],
    ["/api/groups", "POST", "write"],
    // Archiving a group is a write like any other; deleting it is not, and is
    // in the refusals below.
    ["/api/groups/[groupId]", "GET", "read"],
    ["/api/groups/[groupId]", "PATCH", "write"],
    ["/api/notifications", "GET", "read"],
  ] as const)("%s %s is open, and needs %s", (route, method, requires) => {
    const decision = decideScope(route, method);
    expect(decision).toEqual({
      allowed: true,
      requires,
      // A route that names a group can have the pin checked against it, which
      // `authorizeGroup` does. One that does not, and reads stored data, has
      // nothing to check it against — so a pinned key is refused there.
      pinnable: route.includes("[groupId]"),
    });
  });

  /**
   * The two routes that answer out of the request and read nothing.
   *
   * A pinned key is welcome on both, which is not a special case so much as
   * the honest reading of what the pin is for: it bounds which group's *data*
   * a key may see, and these hand back no data at all. Refusing them would
   * leave the share-sheet Shortcut this feature exists for able to file an
   * expense in its one group and unable to work out what the sentence said or
   * what the rate was.
   */
  it.each([
    ["/api/rates", "GET", "read"],
    ["/api/parse", "POST", "write"],
  ] as const)(
    "%s %s is open to a pinned key too",
    (route, method, requires) => {
      expect(decideScope(route, method)).toEqual({
        allowed: true,
        requires,
        pinnable: true,
      });
    },
  );

  /**
   * Every refusal, in one table.
   *
   * The account and the door, plus bulk export — the four groups the feature
   * was specified around. Written out route by route rather than by prefix,
   * because a prefix rule in a test is the same rule as the one under test and
   * would agree with a mistake.
   */
  it.each([
    // The account itself.
    ["/api/auth/session", "POST", "account"],
    ["/api/auth/session", "GET", "account"],
    ["/api/auth/session", "DELETE", "account"],
    ["/api/auth/register", "POST", "account"],
    ["/api/auth/code", "POST", "account"],
    ["/api/auth/options", "GET", "account"],
    ["/api/auth/challenge", "GET", "account"],
    ["/api/auth/passkey", "GET", "account"],
    ["/api/auth/passkey", "DELETE", "account"],
    ["/api/auth/passkey/register", "POST", "account"],
    ["/api/auth/passkey/authenticate", "POST", "account"],
    ["/api/auth/passkey/signup", "POST", "account"],
    ["/api/auth/passkey/signal", "GET", "account"],
    ["/api/auth/passkey/upgrade", "GET", "account"],
    ["/api/auth/apple/start", "GET", "account"],
    ["/api/auth/apple/callback", "POST", "account"],
    ["/api/profile", "GET", "account"],
    ["/api/profile", "PATCH", "account"],
    ["/api/profile", "DELETE", "account"],
    ["/api/profile/avatar", "GET", "account"],
    ["/api/profile/avatar", "POST", "account"],
    ["/api/profile/payouts", "GET", "account"],
    ["/api/profile/payouts", "PUT", "account"],
    ["/api/push/key", "GET", "account"],
    ["/api/push/subscriptions", "POST", "account"],
    ["/api/push/subscriptions/[id]", "DELETE", "account"],
    ["/api/push/test", "POST", "account"],

    // The door: who is in a group, and who can get in.
    ["/api/join/[token]", "GET", "door"],
    ["/api/join/[token]", "POST", "door"],
    ["/api/join/g/[token]", "GET", "door"],
    ["/api/join/g/[token]", "POST", "door"],
    ["/api/groups/[groupId]/join-link", "GET", "door"],
    ["/api/groups/[groupId]/join-link", "POST", "door"],
    ["/api/groups/[groupId]/join-link", "DELETE", "door"],
    ["/api/groups/[groupId]/participants", "GET", "door"],
    ["/api/groups/[groupId]/participants", "POST", "door"],
    ["/api/groups/[groupId]/participants/[participantId]", "PATCH", "door"],
    ["/api/groups/[groupId]/participants/[participantId]", "DELETE", "door"],
    [
      "/api/groups/[groupId]/participants/[participantId]/invitation",
      "POST",
      "door",
    ],
    [
      "/api/groups/[groupId]/participants/[participantId]/invitation",
      "DELETE",
      "door",
    ],
    ["/api/groups/[groupId]", "DELETE", "door"],

    // The whole history in one request.
    ["/api/groups/[groupId]/export", "GET", "bulk"],
  ] as const)("%s %s is refused: %s", (route, method, reason) => {
    expect(decideScope(route, method)).toEqual({ allowed: false, reason });
  });

  it("refuses a route nobody has decided about", () => {
    expect(decideScope("/api/something/new", "GET")).toEqual({
      allowed: false,
      reason: "unknown",
    });
  });

  it("refuses a method the route does not name", () => {
    // `/api/groups/[groupId]` spells out GET, PATCH and DELETE. A PUT is a
    // pair nobody has decided about, and defaults closed like any other.
    expect(decideScope("/api/groups/[groupId]", "PUT")).toEqual({
      allowed: false,
      reason: "unknown",
    });
  });

  it("gives every refusal a sentence somebody can act on", () => {
    const reasons: TokenRefusal[] = [
      "account",
      "door",
      "bulk",
      "anonymous",
      "unknown",
    ];
    for (const reason of reasons) {
      const message = refusalMessage(reason);
      expect(message.length).toBeGreaterThan(20);
      expect(message.endsWith(".")).toBe(true);
    }
  });
});

/**
 * The guard that makes the allowlist an allowlist.
 *
 * `API_ROUTES` is only a decision about every route if it names every route,
 * and nothing but this walk would notice one appearing. A new handler fails
 * the build here until somebody writes down what a key may do with it — which
 * is the way round this has to fail, because the route somebody forgets is
 * always the one added in a hurry.
 */
describe("the table covers the routes on disk", () => {
  const API_DIR = join(process.cwd(), "src/app/api");

  function routeTemplates(dir: string, prefix = "/api"): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        found.push(
          ...routeTemplates(join(dir, entry.name), `${prefix}/${entry.name}`),
        );
      } else if (entry.name === "route.ts") {
        found.push(prefix);
      }
    }
    return found;
  }

  const onDisk = routeTemplates(API_DIR).sort();
  const inTable = Object.keys(API_ROUTES).sort();

  it("finds the routes at all", () => {
    expect(onDisk.length).toBeGreaterThan(30);
  });

  it("has an entry for every route", () => {
    const missing = onDisk.filter((route) => !inTable.includes(route));
    expect(
      missing,
      `${missing.join(", ")} — a new route under src/app/api/ has no entry in ` +
        `API_ROUTES. Decide what an API key may do with it; "open" if it is ` +
        `ordinary group data, one of the refusal reasons if it is not.`,
    ).toEqual([]);
  });

  it("has no entry for a route that no longer exists", () => {
    const stale = inTable.filter((route) => !onDisk.includes(route));
    expect(
      stale,
      `${stale.join(", ")} — API_ROUTES names a route that is not on disk. A ` +
        `stale row reads as a decision somebody made about live code.`,
    ).toEqual([]);
  });
});
