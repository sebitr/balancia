import { describe, expect, it } from "vitest";
import {
  checkRedirectUri,
  describeRedirect,
  redirectUriMatches,
  withParameters,
} from "./redirect-uri";

/**
 * Where an authorization answer may be sent.
 *
 * The answer carries a code, and the address is chosen by whoever registered
 * the client, so these are the cases a stranger would try. Each refusal is a
 * way to get a code delivered somewhere a person did not expect; each
 * acceptance is a client that really exists.
 */

describe("an address accepted at registration", () => {
  it.each([
    // The hosted clients.
    "https://claude.ai/api/mcp/auth_callback",
    "https://chatgpt.com/connector_platform_oauth_redirect",
    // A native application listening on its own machine (RFC 8252 §7.3).
    "http://localhost:3118/callback",
    "http://localhost/callback",
    "http://127.0.0.1:33418/",
    "http://[::1]:5000/cb",
    // A native application registered with the operating system (§7.1).
    "cursor://anysphere.cursor-retrieval/oauth/user-balancia/callback",
    "vscode://vscode.github-authentication/did-authenticate",
    "com.example.app:/oauth2redirect",
  ])("%s", (uri) => {
    expect(checkRedirectUri(uri)).toEqual({ ok: true });
  });
});

describe("an address refused at registration", () => {
  it.each([
    ["plain http to a real host", "http://example.com/callback"],
    [
      "http to a host that merely starts with localhost",
      "http://localhost.evil.com/cb",
    ],
    ["a script", "javascript:alert(1)"],
    ["inline data", "data:text/html,<script>1</script>"],
    ["a file", "file:///etc/passwd"],
    ["a blob", "blob:https://example.com/uuid"],
    ["a fragment", "https://example.com/cb#frag"],
    ["an empty fragment", "https://example.com/cb#"],
    ["credentials in the address", "https://user:pass@example.com/cb"],
    ["whitespace", "https://example.com/a b"],
    ["a tab the parser would drop", "https://exa\tmple.com/cb"],
    ["a backslash", "https://example.com\\evil.com/cb"],
    ["a control character", "https://example.com/\u0001"],
    ["not a URL", "not a url"],
    ["an empty string", ""],
    ["ftp", "ftp://example.com/cb"],
    ["a websocket", "wss://example.com/cb"],
  ])("%s", (_name, uri) => {
    expect(checkRedirectUri(uri).ok).toBe(false);
  });

  it("refuses what is not a string", () => {
    expect(checkRedirectUri(undefined).ok).toBe(false);
    expect(checkRedirectUri(42).ok).toBe(false);
    expect(checkRedirectUri(null).ok).toBe(false);
    expect(checkRedirectUri(["https://example.com/cb"]).ok).toBe(false);
  });

  it("refuses an address longer than any client needs", () => {
    expect(checkRedirectUri(`https://example.com/${"a".repeat(2100)}`).ok).toBe(
      false,
    );
  });
});

describe("matching a request against what was registered", () => {
  const registered = [
    "https://claude.ai/api/mcp/auth_callback",
    "http://localhost:3118/callback",
  ];

  it("takes an exact match", () => {
    expect(
      redirectUriMatches(registered, "https://claude.ai/api/mcp/auth_callback"),
    ).toBe(true);
  });

  it("takes nothing that is merely close", () => {
    for (const requested of [
      "https://claude.ai/api/mcp/auth_callback/",
      "https://claude.ai/api/mcp/auth_callback?x=1",
      "https://claude.ai/api/mcp/auth_callbackx",
      "https://claude.ai:444/api/mcp/auth_callback",
      "https://CLAUDE.ai/api/mcp/auth_callback/..",
      "https://claude.ai.evil.com/api/mcp/auth_callback",
      "https://evil.com/api/mcp/auth_callback",
      "http://claude.ai/api/mcp/auth_callback",
    ]) {
      expect(redirectUriMatches(registered, requested)).toBe(false);
    }
  });

  it("lets a loopback address choose its own port, and nothing else about it", () => {
    expect(
      redirectUriMatches(registered, "http://localhost:51234/callback"),
    ).toBe(true);
    expect(redirectUriMatches(registered, "http://localhost/callback")).toBe(
      true,
    );
    // Another path, another query, or the other spelling of loopback: no.
    expect(redirectUriMatches(registered, "http://localhost:51234/other")).toBe(
      false,
    );
    expect(
      redirectUriMatches(registered, "http://localhost:51234/callback?x=1"),
    ).toBe(false);
    expect(
      redirectUriMatches(registered, "http://127.0.0.1:51234/callback"),
    ).toBe(false);
  });

  it("never lets a port wander on an address that is not loopback", () => {
    expect(
      redirectUriMatches(
        ["https://example.com/cb"],
        "https://example.com:8443/cb",
      ),
    ).toBe(false);
  });

  it("refuses an unsafe address even if one somehow got registered", () => {
    expect(
      redirectUriMatches(["javascript:alert(1)"], "javascript:alert(1)"),
    ).toBe(false);
    expect(
      redirectUriMatches(["http://example.com/cb"], "http://example.com/cb"),
    ).toBe(false);
  });
});

describe("saying where an address leads", () => {
  it("names the host of a web address", () => {
    expect(describeRedirect("https://claude.ai/api/mcp/auth_callback")).toEqual(
      { kind: "web", label: "claude.ai" },
    );
  });

  it("marks a loopback address as an application on this computer", () => {
    expect(describeRedirect("http://localhost:3118/callback")).toEqual({
      kind: "local",
      label: "localhost",
    });
  });

  it("gives a native scheme as its scheme", () => {
    expect(describeRedirect("cursor://anysphere.cursor-retrieval/x")).toEqual({
      kind: "app",
      label: "cursor://",
    });
  });
});

describe("building the answer", () => {
  it("adds parameters and keeps a query the address already had", () => {
    const url = new URL(
      withParameters("https://example.com/cb?tenant=a", {
        code: "abc",
        state: "x y&z",
        iss: "https://balancia.example",
      }),
    );

    expect(url.searchParams.get("tenant")).toBe("a");
    expect(url.searchParams.get("code")).toBe("abc");
    // Encoded, not concatenated: a `&` in the state cannot add a parameter.
    expect(url.searchParams.get("state")).toBe("x y&z");
    expect(url.searchParams.get("iss")).toBe("https://balancia.example");
  });

  it("leaves a missing state out rather than writing the word undefined", () => {
    const url = new URL(
      withParameters("https://example.com/cb", {
        code: "abc",
        state: undefined,
      }),
    );
    expect(url.searchParams.has("state")).toBe(false);
  });

  it("survives a native scheme", () => {
    const out = withParameters("cursor://anysphere.cursor-retrieval/cb", {
      code: "abc",
    });
    expect(out.startsWith("cursor://anysphere.cursor-retrieval/cb?")).toBe(
      true,
    );
    expect(out).toContain("code=abc");
  });
});
