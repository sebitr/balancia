import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetEnvCache } from "@/lib/env";
import {
  buildAuthorizeUrl,
  challengeFor,
  describeAccount,
  exchangeCode,
  randomToken,
  redirectUri,
  refreshAccessToken,
} from "./oauth";

/**
 * Nothing here talks to Google, Dropbox or Microsoft. The requests are checked
 * against what each provider documents, and the answers are shaped like the
 * documented ones — which is as far as a unit test can honestly go, and why
 * `docs/cloud-backup.md` ends with a live checklist.
 */

const SECRET = "the-client-secret-value";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-0123456789abcdef0123456789abcdef";
  process.env.DATABASE_URL = "postgres://balancia:pw@localhost:5432/balancia";
  process.env.APP_URL = "https://balancia.example.com";
  for (const name of ["GOOGLE", "DROPBOX", "MICROSOFT"]) {
    process.env[`BACKUP_${name}_CLIENT_ID`] = `${name.toLowerCase()}-id`;
    process.env[`BACKUP_${name}_CLIENT_SECRET`] = SECRET;
  }
  resetEnvCache();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const name of ["GOOGLE", "DROPBOX", "MICROSOFT"]) {
    delete process.env[`BACKUP_${name}_CLIENT_ID`];
    delete process.env[`BACKUP_${name}_CLIENT_SECRET`];
  }
  resetEnvCache();
});

function answer(body: unknown, status = 200) {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentBody(
  fetchMock: ReturnType<typeof answer>,
  call = 0,
): URLSearchParams {
  const init = (
    fetchMock.mock.calls[call] as unknown as [string, RequestInit]
  )[1];
  return new URLSearchParams(init.body as URLSearchParams);
}

describe("the authorization request", () => {
  const input = { state: "s-123", challenge: "c-456" };

  it("asks Google for files this app made, and nothing wider", () => {
    const url = buildAuthorizeUrl("google", input);

    expect(url.origin + url.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(url.searchParams.get("scope")).toBe(
      "https://www.googleapis.com/auth/drive.file",
    );
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("asks OneDrive for the app folder, from the personal-accounts authority", () => {
    const url = buildAuthorizeUrl("microsoft", input);

    expect(url.pathname).toContain("/consumers/");
    expect(url.searchParams.get("scope")?.split(" ")).toEqual([
      "offline_access",
      "Files.ReadWrite.AppFolder",
      "User.Read",
    ]);
  });

  it("asks Dropbox for a refresh token it can keep", () => {
    const url = buildAuthorizeUrl("dropbox", input);

    expect(url.searchParams.get("token_access_type")).toBe("offline");
  });

  it.each(["google", "dropbox", "microsoft"] as const)(
    "binds %s's answer to this browser with state and PKCE",
    (kind) => {
      const url = buildAuthorizeUrl(kind, input);

      expect(url.searchParams.get("state")).toBe("s-123");
      expect(url.searchParams.get("code_challenge")).toBe("c-456");
      expect(url.searchParams.get("code_challenge_method")).toBe("S256");
      expect(url.searchParams.get("response_type")).toBe("code");
      expect(url.searchParams.get("redirect_uri")).toBe(redirectUri(kind));
      expect(url.search).not.toContain(SECRET);
    },
  );

  it("comes back to this instance's own address", () => {
    expect(redirectUri("google")).toBe(
      "https://balancia.example.com/api/backup/oauth/google/callback",
    );
  });

  it("refuses when there is no app at all: none of the person's own, none for the server", () => {
    delete process.env.BACKUP_GOOGLE_CLIENT_ID;
    delete process.env.BACKUP_GOOGLE_CLIENT_SECRET;
    resetEnvCache();

    expect(() => buildAuthorizeUrl("google", input)).toThrowError(
      expect.objectContaining({ code: "app" }),
    );
  });

  describe("through an app of the person's own", () => {
    const own = { clientId: "mine.apps.example", clientSecret: "my-secret-9" };

    it("asks as that app, in place of the server's", () => {
      const url = buildAuthorizeUrl("google", { ...input, app: own });

      expect(url.searchParams.get("client_id")).toBe("mine.apps.example");
      expect(url.searchParams.get("client_id")).not.toBe("google-id");
    });

    it("works on a server that registered nothing", () => {
      delete process.env.BACKUP_DROPBOX_CLIENT_ID;
      delete process.env.BACKUP_DROPBOX_CLIENT_SECRET;
      resetEnvCache();

      const url = buildAuthorizeUrl("dropbox", { ...input, app: own });

      expect(url.searchParams.get("client_id")).toBe("mine.apps.example");
    });

    it("never puts the secret in the address the browser is sent to", () => {
      const url = buildAuthorizeUrl("microsoft", { ...input, app: own });

      expect(url.toString()).not.toContain("my-secret-9");
    });
  });
});

describe("PKCE", () => {
  it("derives the challenge from the verifier the way RFC 7636 says", () => {
    // The worked example in RFC 7636 appendix B.
    expect(challengeFor("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
      "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
    );
  });

  it("never repeats", () => {
    expect(randomToken()).not.toBe(randomToken());
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
  });
});

describe("exchangeCode", () => {
  const now = new Date("2026-10-09T03:00:00Z");

  it("trades the code for a refresh token and says when the access token ends", async () => {
    const fetchMock = answer({
      access_token: "at-1",
      refresh_token: "rt-1",
      expires_in: 3599,
    });

    const tokens = await exchangeCode(
      "google",
      { code: "code-1", verifier: "v-1" },
      now,
    );

    expect(tokens).toEqual({
      accessToken: "at-1",
      refreshToken: "rt-1",
      expiresAt: new Date("2026-10-09T03:59:59Z"),
    });
    const body = sentBody(fetchMock);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code_verifier")).toBe("v-1");
    expect(body.get("client_secret")).toBe(SECRET);
  });

  it("trades the code as the person's own app, not the server's", async () => {
    const fetchMock = answer({ access_token: "at-1", refresh_token: "rt-1" });

    await exchangeCode("google", {
      code: "code-1",
      verifier: "v-1",
      app: { clientId: "mine", clientSecret: "my-secret-9" },
    });

    const body = sentBody(fetchMock);
    expect(body.get("client_id")).toBe("mine");
    expect(body.get("client_secret")).toBe("my-secret-9");
  });

  it("does not echo the person's own secret when the provider does", async () => {
    answer(
      { error: "invalid_grant", error_description: "bad my-secret-9" },
      400,
    );

    const failure = await exchangeCode("google", {
      code: "code-1",
      verifier: "v-1",
      app: { clientId: "mine", clientSecret: "my-secret-9" },
    }).catch((error: unknown) => error);

    expect(JSON.stringify(failure)).not.toContain("my-secret-9");
  });

  it("tells a refused app from a refused code: a wrong secret is not a reason to try the same trip", async () => {
    answer({ error: "invalid_client", error_description: "Unauthorized" }, 401);

    await expect(
      exchangeCode("google", { code: "c", verifier: "v" }),
    ).rejects.toMatchObject({ code: "app" });
  });

  it("is not satisfied with an hour of access", async () => {
    answer({ access_token: "at-1", expires_in: 3600 });

    await expect(
      exchangeCode("dropbox", { code: "c", verifier: "v" }, now),
    ).rejects.toMatchObject({ code: "reconnect" });
  });

  it("reports a refused code as a reason to try again, without echoing secrets", async () => {
    answer(
      {
        error: "invalid_grant",
        error_description: `bad code ${SECRET} code-1`,
      },
      400,
    );

    const failure = await exchangeCode("google", {
      code: "code-1",
      verifier: "v-1",
    }).catch((error: unknown) => error);

    expect(failure).toMatchObject({ code: "reconnect" });
    expect(JSON.stringify(failure)).not.toContain(SECRET);
    expect((failure as Error).message).not.toContain("code-1");
  });

  it("reports no network as unreachable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    await expect(
      exchangeCode("microsoft", { code: "c", verifier: "v" }),
    ).rejects.toMatchObject({ code: "unreachable" });
  });
});

describe("refreshAccessToken", () => {
  it("asks Microsoft for the same scope again, as its endpoint requires", async () => {
    const fetchMock = answer({
      access_token: "at-2",
      refresh_token: "rt-rotated",
      expires_in: 3600,
    });

    const tokens = await refreshAccessToken("microsoft", "rt-1");

    expect(sentBody(fetchMock).get("scope")).toContain(
      "Files.ReadWrite.AppFolder",
    );
    expect(tokens.refreshToken).toBe("rt-rotated");
  });

  it("leaves the refresh token unset when the provider keeps the old one", async () => {
    answer({ access_token: "at-2", expires_in: 14400 });

    const tokens = await refreshAccessToken("dropbox", "rt-1");

    expect(tokens.refreshToken).toBeUndefined();
    expect(tokens.accessToken).toBe("at-2");
  });

  it("says to reconnect when access was taken back", async () => {
    answer(
      { error: "invalid_grant", error_description: "Token has been revoked." },
      400,
    );

    await expect(refreshAccessToken("google", "rt-1")).rejects.toMatchObject({
      code: "reconnect",
    });
  });

  it("says the app was refused when it was removed or its secret changed, not that access was taken back", async () => {
    answer({ error: "invalid_client" }, 401);

    await expect(refreshAccessToken("dropbox", "rt-1")).rejects.toMatchObject({
      code: "app",
    });
  });

  it("refreshes as the connection's own app, because a token only works for the client it was issued to", async () => {
    const fetchMock = answer({ access_token: "at-2", expires_in: 3600 });

    await refreshAccessToken("google", "rt-1", new Date(), {
      clientId: "mine",
      clientSecret: "my-secret-9",
    });

    const body = sentBody(fetchMock);
    expect(body.get("client_id")).toBe("mine");
    expect(body.get("client_secret")).toBe("my-secret-9");
    expect(body.get("refresh_token")).toBe("rt-1");
  });

  it("falls back to the server's app for a connection that has none of its own", async () => {
    const fetchMock = answer({ access_token: "at-2", expires_in: 3600 });

    await refreshAccessToken("google", "rt-1");

    expect(sentBody(fetchMock).get("client_id")).toBe("google-id");
  });

  it("does not treat the provider having a bad day as a revoked token", async () => {
    answer({ error: "temporarily_unavailable" }, 503);

    await expect(refreshAccessToken("google", "rt-1")).rejects.toMatchObject({
      code: "unreachable",
    });
  });
});

describe("describeAccount", () => {
  it("reads Google's address from Drive itself, so no extra permission is asked", async () => {
    const fetchMock = answer({ user: { emailAddress: "ada@gmail.com" } });

    expect(await describeAccount("google", "at")).toEqual({
      account: "ada@gmail.com",
    });
    expect(
      String((fetchMock.mock.calls[0] as unknown as [string])[0]),
    ).toContain("drive/v3/about");
  });

  it("reads Dropbox's", async () => {
    answer({ email: "ada@example.com", name: { display_name: "Ada" } });

    expect(await describeAccount("dropbox", "at")).toEqual({
      account: "ada@example.com",
    });
  });

  it("finds OneDrive's app folder, which rclone needs to be pointed at", async () => {
    const responses = [
      { mail: "ada@outlook.com", userPrincipalName: "ada_outlook.com#EXT#" },
      {
        id: "FOLDER-ID",
        parentReference: { driveId: "b!drive", driveType: "personal" },
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(responses.shift()), { status: 200 }),
      ),
    );

    expect(await describeAccount("microsoft", "at")).toEqual({
      account: "ada@outlook.com",
      onedrive: {
        driveId: "b!drive",
        driveType: "personal",
        rootFolderId: "FOLDER-ID",
      },
    });
  });

  it("refuses a OneDrive that cannot say where the app folder is", async () => {
    const responses = [
      { mail: "ada@outlook.com" },
      { id: "x", parentReference: {} },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(responses.shift()), { status: 200 }),
      ),
    );

    await expect(describeAccount("microsoft", "at")).rejects.toMatchObject({
      code: "unknown",
    });
  });
});
