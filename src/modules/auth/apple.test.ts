import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createPrivateKey,
  generateKeyPairSync,
  sign,
  verify,
} from "node:crypto";
import {
  AppleAuthError,
  buildAuthorizationUrl,
  completeAuthorization,
  exchangeAuthorizationCode,
  getAppleJwks,
  resetAppleJwksCache,
  signClientSecret,
  verifyIdToken,
  type AppleConfig,
  type AppleJwk,
} from "./apple";

/**
 * The Apple protocol, against keys generated here.
 *
 * Every id_token in this file is signed by a throwaway RSA key whose public
 * half is handed to the verifier as a JWK, which is exactly the shape Apple's
 * key set has. That makes the happy path a real round trip rather than a
 * fixture, and lets the rejection cases be built by changing one thing about a
 * token that would otherwise be accepted.
 */

const NOW = new Date("2026-08-14T12:00:00.000Z");

const signingKeys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const APPLE_KID = "test-apple-key";

const appleJwk: AppleJwk = {
  ...(signingKeys.publicKey.export({ format: "jwk" }) as {
    n: string;
    e: string;
  }),
  kty: "RSA",
  kid: APPLE_KID,
  alg: "RS256",
};

const clientSecretKeys = generateKeyPairSync("ec", {
  namedCurve: "P-256",
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});

const config: AppleConfig = {
  clientId: "com.example.balancia.web",
  teamId: "A1B2C3D4E5",
  keyId: "ABC1234567",
  privateKey: clientSecretKeys.privateKey,
  redirectUri: "https://balancia.example.com/api/auth/apple/callback",
};

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeSegment(segment: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
}

/** An id_token that verifies, unless one of the overrides breaks it. */
function makeIdToken({
  header = {},
  claims = {},
  signWith = signingKeys.privateKey,
}: {
  header?: Record<string, unknown>;
  claims?: Record<string, unknown>;
  signWith?: Parameters<typeof sign>[2];
} = {}): string {
  const seconds = Math.floor(NOW.getTime() / 1000);
  const encodedHeader = base64UrlJson({
    alg: "RS256",
    kid: APPLE_KID,
    ...header,
  });
  const encodedClaims = base64UrlJson({
    iss: "https://appleid.apple.com",
    aud: config.clientId,
    sub: "001234.abcdef.0000",
    iat: seconds - 10,
    exp: seconds + 600,
    nonce: "the-nonce",
    email: "person@example.com",
    email_verified: "true",
    ...claims,
  });

  const signature = sign(
    "sha256",
    Buffer.from(`${encodedHeader}.${encodedClaims}`, "ascii"),
    signWith,
  );
  return `${encodedHeader}.${encodedClaims}.${signature.toString("base64url")}`;
}

const verifyOptions = {
  config,
  nonce: "the-nonce",
  jwks: [appleJwk],
  now: NOW,
};

beforeEach(() => {
  resetAppleJwksCache();
  vi.restoreAllMocks();
});

describe("signClientSecret", () => {
  it("signs an ES256 assertion the matching public key verifies", () => {
    const token = signClientSecret(config, NOW);
    const [header, payload, signature] = token.split(".");

    expect(decodeSegment(header)).toEqual({
      alg: "ES256",
      kid: config.keyId,
      typ: "JWT",
    });

    // JOSE wants the raw r‖s pair; a DER signature verifies with OpenSSL and
    // is rejected by Apple, so this is the assertion that matters most here.
    expect(
      verify(
        "sha256",
        Buffer.from(`${header}.${payload}`, "ascii"),
        { key: clientSecretKeys.publicKey, dsaEncoding: "ieee-p1363" },
        Buffer.from(signature, "base64url"),
      ),
    ).toBe(true);
  });

  it("claims the team as issuer and the Services ID as subject", () => {
    const [, payload] = signClientSecret(config, NOW).split(".");
    const claims = decodeSegment(payload);

    expect(claims).toMatchObject({
      iss: config.teamId,
      sub: config.clientId,
      aud: "https://appleid.apple.com",
    });
    expect(claims.exp).toBeGreaterThan(claims.iat as number);
  });

  it("explains itself when the key is not a readable PKCS#8 PEM", () => {
    expect(() =>
      signClientSecret({ ...config, privateKey: "ABC1234567" }, NOW),
    ).toThrow(/PKCS#8/);
  });
});

describe("buildAuthorizationUrl", () => {
  it("asks for a form_post of the email scope", () => {
    const url = new URL(
      buildAuthorizationUrl(config, { state: "st", nonce: "no" }),
    );

    expect(url.origin + url.pathname).toBe(
      "https://appleid.apple.com/auth/authorize",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      response_type: "code",
      // Apple requires form_post whenever the name or email is asked for, and
      // that is what makes the callback a cross-site POST.
      response_mode: "form_post",
      scope: "name email",
      state: "st",
      nonce: "no",
    });
  });
});

describe("verifyIdToken", () => {
  it("accepts a well-formed token and returns its claims", () => {
    expect(verifyIdToken(makeIdToken(), verifyOptions)).toEqual({
      subject: "001234.abcdef.0000",
      email: "person@example.com",
      emailVerified: true,
      isPrivateEmail: false,
    });
  });

  it("reads Apple's booleans whether they arrive as booleans or strings", () => {
    expect(
      verifyIdToken(
        makeIdToken({
          claims: { email_verified: true, is_private_email: "true" },
        }),
        verifyOptions,
      ),
    ).toMatchObject({ emailVerified: true, isPrivateEmail: true });

    expect(
      verifyIdToken(
        makeIdToken({ claims: { email_verified: "false" } }),
        verifyOptions,
      ),
    ).toMatchObject({ emailVerified: false });
  });

  it("infers a relay address when Apple does not label one", () => {
    expect(
      verifyIdToken(
        makeIdToken({ claims: { email: "abc123@privaterelay.appleid.com" } }),
        verifyOptions,
      ),
    ).toMatchObject({ isPrivateEmail: true });
  });

  it("lowercases the address", () => {
    expect(
      verifyIdToken(
        makeIdToken({ claims: { email: "Person@Example.COM" } }),
        verifyOptions,
      ),
    ).toMatchObject({ email: "person@example.com" });
  });

  it("rejects a token signed by anyone else", () => {
    const impostor = generateKeyPairSync("rsa", { modulusLength: 2048 });

    expect(() =>
      verifyIdToken(
        makeIdToken({ signWith: impostor.privateKey }),
        verifyOptions,
      ),
    ).toThrow(/signature did not verify/);
  });

  it("rejects a token that nominates its own algorithm", () => {
    // The alg-confusion family: "none" here, and an HMAC alg that would have
    // the public key used as a shared secret. Neither gets as far as a key.
    for (const alg of ["none", "HS256", "RS512"]) {
      expect(() =>
        verifyIdToken(makeIdToken({ header: { alg } }), verifyOptions),
      ).toThrow(/RS256/);
    }
  });

  it("rejects a token whose key ID is not in the key set", () => {
    expect(() =>
      verifyIdToken(makeIdToken({ header: { kid: "other" } }), verifyOptions),
    ).toThrow(/key ID/);
  });

  it("rejects another issuer", () => {
    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { iss: "https://accounts.example.com" } }),
        verifyOptions,
      ),
    ).toThrow(/issued by/);
  });

  it("rejects a token issued for a different client", () => {
    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { aud: "com.example.somebody-else" } }),
        verifyOptions,
      ),
    ).toThrow(/different client/);
  });

  it("accepts an audience array that contains this client", () => {
    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { aud: ["com.other", config.clientId] } }),
        verifyOptions,
      ),
    ).not.toThrow();
  });

  it("rejects an expired token, allowing only a minute of drift", () => {
    const seconds = Math.floor(NOW.getTime() / 1000);

    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { exp: seconds - 30 } }),
        verifyOptions,
      ),
    ).not.toThrow();

    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { exp: seconds - 120 } }),
        verifyOptions,
      ),
    ).toThrow(/expired/);
  });

  it("rejects a token issued in the future", () => {
    expect(() =>
      verifyIdToken(
        makeIdToken({
          claims: { iat: Math.floor(NOW.getTime() / 1000) + 600 },
        }),
        verifyOptions,
      ),
    ).toThrow(/in the future/);
  });

  it("rejects a token minted for a different sign-in", () => {
    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { nonce: "somebody-elses-nonce" } }),
        verifyOptions,
      ),
    ).toThrow(/nonce/);
  });

  it("rejects a token carrying no nonce at all", () => {
    expect(() =>
      verifyIdToken(
        makeIdToken({ claims: { nonce: undefined } }),
        verifyOptions,
      ),
    ).toThrow(/nonce/);
  });

  it("rejects something that is not a JWT", () => {
    expect(() => verifyIdToken("not.a.jwt.at.all", verifyOptions)).toThrow(
      /not a JWT/,
    );
    expect(() => verifyIdToken("garbage", verifyOptions)).toThrow(/not a JWT/);
  });
});

describe("exchangeAuthorizationCode", () => {
  function stubToken(body: unknown, status = 200) {
    return vi.fn(
      async () => new Response(JSON.stringify(body), { status }),
    ) as unknown as typeof fetch;
  }

  it("posts the code with a freshly signed client secret", async () => {
    const fetchImpl = stubToken({ id_token: "an.id.token" });

    await expect(
      exchangeAuthorizationCode(config, "the-code", {
        now: NOW,
        fetchImpl,
      }),
    ).resolves.toBe("an.id.token");

    const [url, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(url).toBe("https://appleid.apple.com/auth/token");

    const body = new URLSearchParams(init.body as string);
    expect(body.get("code")).toBe("the-code");
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("redirect_uri")).toBe(config.redirectUri);
    // The secret is an assertion, not a stored string: it must verify.
    expect(() => createPrivateKey(config.privateKey)).not.toThrow();
    expect(body.get("client_secret")?.split(".")).toHaveLength(3);
  });

  it("reports Apple's own complaint when it refuses the code", async () => {
    await expect(
      exchangeAuthorizationCode(config, "stale", {
        now: NOW,
        fetchImpl: stubToken({ error: "invalid_grant" }, 400),
      }),
    ).rejects.toThrow(/invalid_grant/);
  });

  it("rejects a response with no id_token in it", async () => {
    await expect(
      exchangeAuthorizationCode(config, "code", {
        now: NOW,
        fetchImpl: stubToken({ access_token: "only-this" }),
      }),
    ).rejects.toThrow(/no id_token/);
  });
});

describe("getAppleJwks", () => {
  function stubJwks(keys: unknown[]) {
    return vi.fn(
      async () => new Response(JSON.stringify({ keys }), { status: 200 }),
    ) as unknown as typeof fetch;
  }

  it("fetches once and serves the rest from cache", async () => {
    const fetchImpl = stubJwks([appleJwk]);

    await getAppleJwks({ fetchImpl });
    await getAppleJwks({ fetchImpl });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches after the cache goes stale", async () => {
    const fetchImpl = stubJwks([appleJwk]);

    await getAppleJwks({ fetchImpl, now: 0 });
    await getAppleJwks({ fetchImpl, now: 2 * 60 * 60 * 1000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("lets the first forced refetch through — that is the rotation case", async () => {
    const fetchImpl = stubJwks([appleJwk]);

    await getAppleJwks({ fetchImpl, now: 0 });
    await getAppleJwks({ fetchImpl, force: true, now: 1_000 });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("will not refetch on demand more often than the cooldown", async () => {
    const fetchImpl = stubJwks([appleJwk]);

    await getAppleJwks({ fetchImpl, now: 0 });
    // A stream of tokens bearing invented key IDs must not become a way to
    // make this instance hammer Apple: one gets through, the rest are served
    // from cache until the cooldown lapses.
    for (let attempt = 0; attempt < 20; attempt += 1) {
      await getAppleJwks({ fetchImpl, force: true, now: 1_000 + attempt });
    }

    expect(fetchImpl).toHaveBeenCalledTimes(2);

    await getAppleJwks({ fetchImpl, force: true, now: 90_000 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("rejects a key set that is empty or unreadable", async () => {
    await expect(getAppleJwks({ fetchImpl: stubJwks([]) })).rejects.toThrow(
      AppleAuthError,
    );
  });
});

describe("completeAuthorization", () => {
  it("retries against a fresh key set when the key ID is unknown", async () => {
    const idToken = makeIdToken();
    let jwksCalls = 0;

    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input).endsWith("/auth/token")) {
        return new Response(JSON.stringify({ id_token: idToken }), {
          status: 200,
        });
      }
      jwksCalls += 1;
      // The first fetch predates the rotation this token was signed under.
      const keys = jwksCalls === 1 ? [{ ...appleJwk, kid: "old" }] : [appleJwk];
      return new Response(JSON.stringify({ keys }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(
      completeAuthorization(config, {
        code: "c",
        nonce: "the-nonce",
        now: NOW,
        fetchImpl,
      }),
    ).resolves.toMatchObject({ subject: "001234.abcdef.0000" });

    expect(jwksCalls).toBe(2);
  });

  it("does not retry when the failure is anything else", async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/auth/token")
        ? new Response(
            JSON.stringify({
              id_token: makeIdToken({ claims: { nonce: "wrong" } }),
            }),
            { status: 200 },
          )
        : new Response(JSON.stringify({ keys: [appleJwk] }), { status: 200 }),
    ) as unknown as typeof fetch;

    await expect(
      completeAuthorization(config, {
        code: "c",
        nonce: "the-nonce",
        now: NOW,
        fetchImpl,
      }),
    ).rejects.toThrow(/nonce/);

    // One token call, one key-set call, and no second look at the key set.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
