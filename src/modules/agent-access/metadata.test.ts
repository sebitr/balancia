import { describe, expect, it } from "vitest";
import {
  authorizationServerMetadata,
  bearerChallenge,
  isThisResource,
  mcpResourceUrl,
  protectedResourceMetadata,
} from "./metadata";
import { covers, knownScope, requestedScope, scopeString } from "./scopes";

const ORIGIN = "https://balancia.example";

/**
 * What a client reads before it has a token. A wrong word here fails at the
 * client, far from the cause, so the shape is pinned to what Claude's and the
 * MCP specification's requirements say.
 */

describe("the protected resource document (RFC 9728)", () => {
  const doc = protectedResourceMetadata(ORIGIN);

  it("names /mcp as the resource, exactly as a client will type it", () => {
    expect(doc.resource).toBe("https://balancia.example/mcp");
    expect(mcpResourceUrl(ORIGIN)).toBe(doc.resource);
  });

  it("names this server as the one authorization server, and the only one", () => {
    // Claude uses the first entry and does not fall back to later ones.
    expect(doc.authorization_servers).toEqual([ORIGIN]);
  });

  it("accepts the bearer header and nothing else", () => {
    expect(doc.bearer_methods_supported).toEqual(["header"]);
  });
});

describe("the authorization server document (RFC 8414)", () => {
  const doc = authorizationServerMetadata(ORIGIN);

  it("is issued by the instance's own origin", () => {
    expect(doc.issuer).toBe(ORIGIN);
  });

  it("points at every endpoint the flow needs", () => {
    expect(doc.authorization_endpoint).toBe(`${ORIGIN}/oauth/authorize`);
    expect(doc.token_endpoint).toBe(`${ORIGIN}/oauth/token`);
    expect(doc.registration_endpoint).toBe(`${ORIGIN}/oauth/register`);
    expect(doc.revocation_endpoint).toBe(`${ORIGIN}/oauth/revoke`);
  });

  it("offers S256 and no weaker method", () => {
    expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
  });

  it("offers public clients only, because there is no secret to keep", () => {
    expect(doc.token_endpoint_auth_methods_supported).toEqual(["none"]);
  });

  it("offers the two grants it implements", () => {
    expect(doc.grant_types_supported).toEqual([
      "authorization_code",
      "refresh_token",
    ]);
    expect(doc.response_types_supported).toEqual(["code"]);
  });

  it("promises the issuer in every authorization response (RFC 9207)", () => {
    expect(doc.authorization_response_iss_parameter_supported).toBe(true);
  });

  it("lists the same scopes as the resource", () => {
    expect(doc.scopes_supported).toEqual(
      protectedResourceMetadata(ORIGIN).scopes_supported,
    );
  });
});

describe("the challenge on a 401", () => {
  it("points the client at the protected resource document", () => {
    expect(bearerChallenge(ORIGIN)).toBe(
      'Bearer resource_metadata="https://balancia.example/.well-known/oauth-protected-resource"',
    );
  });

  it("says why a token was refused, in the order RFC 6750 uses", () => {
    expect(
      bearerChallenge(ORIGIN, {
        error: "invalid_token",
        description: "expired",
      }),
    ).toBe(
      'Bearer resource_metadata="https://balancia.example/.well-known/oauth-protected-resource", error="invalid_token", error_description="expired"',
    );
  });

  it("cannot be made to break out of its own quotes", () => {
    const header = bearerChallenge(ORIGIN, {
      description: 'x", error="none',
    });
    expect(header).toContain('error_description="x, error=none"');
    expect(header.match(/"/g)!.length % 2).toBe(0);
  });
});

describe("which resource a token is for", () => {
  it("is this server's /mcp, with or without a trailing slash", () => {
    expect(isThisResource("https://balancia.example/mcp", ORIGIN)).toBe(true);
    expect(isThisResource("https://balancia.example/mcp/", ORIGIN)).toBe(true);
  });

  it("is nothing else — not the origin, not another path, not another host", () => {
    for (const other of [
      "https://balancia.example",
      "https://balancia.example/api/groups",
      "https://balancia.example/mcp2",
      "https://evil.example/mcp",
      "http://balancia.example/mcp",
    ]) {
      expect(isThisResource(other, ORIGIN)).toBe(false);
    }
  });
});

describe("scopes", () => {
  it("lets write carry read with it", () => {
    expect(scopeString("write")).toBe("balancia:read balancia:write");
    expect(scopeString("read")).toBe("balancia:read");
  });

  it("asks for everything when a request names nothing", () => {
    expect(requestedScope(undefined)).toBe("write");
    expect(requestedScope("")).toBe("write");
  });

  it("asks for less when a request names less", () => {
    expect(requestedScope("balancia:read")).toBe("read");
    expect(requestedScope("balancia:read balancia:write")).toBe("write");
  });

  it("ignores names it does not know, as RFC 6749 allows", () => {
    expect(requestedScope("offline_access balancia:read")).toBe("read");
    // …and does not mistake "nothing I know" for a request on a refresh.
    expect(knownScope("offline_access")).toBeNull();
  });

  it("covers a request only when the grant is at least as wide", () => {
    expect(covers("write", "read")).toBe(true);
    expect(covers("write", "write")).toBe(true);
    expect(covers("read", "read")).toBe(true);
    expect(covers("read", "write")).toBe(false);
  });
});
