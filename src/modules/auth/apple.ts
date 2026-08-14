import "server-only";
import {
  constants,
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
} from "node:crypto";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { APPLE_CALLBACK_PATH } from "./apple-paths";

/**
 * Sign in with Apple — the OpenID Connect half.
 *
 * Implemented on `node:crypto` rather than an OIDC client, for the reason
 * given in decision 17 of docs/architecture.md: this is one signed ES256
 * assertion and one verified RS256 token against a published key set, which is
 * a small amount of fully specified code that can be tested against its own
 * round trip. A general OIDC library would bring discovery, session handling
 * and a dozen grant types that Balancia has no use for.
 *
 * Everything here is protocol. Nothing in this file touches the database or
 * decides who is signed in; `signInWithApple` in service.ts does that with the
 * claims this returns.
 *
 * The flow, for whoever reads this next:
 *
 *   1. /api/auth/apple/start sends the browser to `buildAuthorizationUrl`,
 *      having put the matching `state` and `nonce` in a cookie.
 *   2. Apple form-POSTs back to /api/auth/apple/callback with a code.
 *   3. `exchangeAuthorizationCode` trades the code for an id_token, proving
 *      this instance is who it claims by signing a client secret with its .p8.
 *   4. `verifyIdToken` checks that token's signature, issuer, audience,
 *      expiry and nonce before a single claim in it is believed.
 */

const ISSUER = "https://appleid.apple.com";
const AUTHORIZATION_ENDPOINT = `${ISSUER}/auth/authorize`;
const TOKEN_ENDPOINT = `${ISSUER}/auth/token`;
const JWKS_ENDPOINT = `${ISSUER}/auth/keys`;

/** Apple's own limit on a client secret is 6 months. This is not that. */
const CLIENT_SECRET_TTL_SECONDS = 5 * 60;

/** Tolerance for clock drift between this instance and Apple, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

const REQUEST_TIMEOUT_MS = 10_000;

/** Apple's signing keys rotate rarely; an hour is a conservative cache. */
const JWKS_TTL_MS = 60 * 60 * 1000;

/**
 * Floor between refetches triggered by an unrecognised `kid`.
 *
 * Without it, a stream of tokens bearing invented key IDs would become a way
 * to make this instance hammer Apple on demand.
 */
const JWKS_REFETCH_COOLDOWN_MS = 60 * 1000;

export class AppleAuthError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AppleAuthError";
  }
}

export interface AppleConfig {
  /** The Services ID. Also the `aud` every id_token must carry. */
  readonly clientId: string;
  readonly teamId: string;
  readonly keyId: string;
  /** PKCS#8 PEM, from the .p8 Apple issued. */
  readonly privateKey: string;
  /** Absolute, and byte-identical to what is registered with Apple. */
  readonly redirectUri: string;
}

/** The configuration, or null on an instance that has not enabled Apple. */
export function getAppleConfig(): AppleConfig | null {
  const env = getEnv();
  if (!env.appleSignInEnabled) return null;
  return {
    clientId: env.APPLE_CLIENT_ID!,
    teamId: env.APPLE_TEAM_ID!,
    keyId: env.APPLE_KEY_ID!,
    privateKey: env.APPLE_PRIVATE_KEY!,
    redirectUri: `${env.appOrigin}${APPLE_CALLBACK_PATH}`,
  };
}

export function requireAppleConfig(): AppleConfig {
  const config = getAppleConfig();
  if (!config) {
    throw new AppleAuthError("Sign in with Apple is not configured.");
  }
  return config;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * The client secret: a short-lived ES256 JWT signed with the .p8 key.
 *
 * Apple has no shared secret to hand out, so this assertion is how the token
 * endpoint knows the request came from an instance holding the team's private
 * key. As in VAPID, JOSE wants the raw r‖s pair rather than the DER sequence
 * Node produces by default — hence `dsaEncoding`.
 *
 * Signed per exchange rather than cached: an ECDSA signature costs less than
 * the round trip it accompanies, and a cache is one more thing to get wrong.
 */
export function signClientSecret(
  config: AppleConfig,
  now: Date = new Date(),
): string {
  const issuedAt = Math.floor(now.getTime() / 1000);

  const header = base64UrlJson({ alg: "ES256", kid: config.keyId, typ: "JWT" });
  const payload = base64UrlJson({
    iss: config.teamId,
    iat: issuedAt,
    exp: issuedAt + CLIENT_SECRET_TTL_SECONDS,
    aud: ISSUER,
    sub: config.clientId,
  });
  const signingInput = `${header}.${payload}`;

  let privateKey;
  try {
    privateKey = createPrivateKey(config.privateKey);
  } catch (error) {
    throw new AppleAuthError(
      "APPLE_PRIVATE_KEY is not a readable PKCS#8 key. Check that the whole .p8 file " +
        "was copied, including both -----BEGIN/END PRIVATE KEY----- lines.",
      { cause: error },
    );
  }

  const signature = sign("sha256", Buffer.from(signingInput, "ascii"), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });

  return `${signingInput}.${signature.toString("base64url")}`;
}

/**
 * Where to send the browser to start the ceremony.
 *
 * `response_mode=form_post` is not a choice: Apple requires it whenever the
 * scope asks for the name or email, and it is what makes the callback a
 * cross-site POST — see the cookie attributes in apple-state.ts.
 */
export function buildAuthorizationUrl(
  config: AppleConfig,
  { state, nonce }: { state: string; nonce: string },
): string {
  const url = new URL(AUTHORIZATION_ENDPOINT);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("response_mode", "form_post");
  url.searchParams.set("scope", "name email");
  url.searchParams.set("state", state);
  url.searchParams.set("nonce", nonce);
  return url.toString();
}

const tokenResponseSchema = z.object({
  id_token: z.string().min(1),
});

/** Trades the authorization code for an id_token. */
export async function exchangeAuthorizationCode(
  config: AppleConfig,
  code: string,
  options: { now?: Date; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const doFetch = options.fetchImpl ?? fetch;

  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: signClientSecret(config, options.now),
    code,
    grant_type: "authorization_code",
    redirect_uri: config.redirectUri,
  });

  let response: Response;
  try {
    response = await doFetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: body.toString(),
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppleAuthError("Could not reach Apple's token endpoint.", {
      cause: error,
    });
  }

  if (!response.ok) {
    // Apple answers 400 with an OAuth error code. `invalid_client` is nearly
    // always a misconfigured team, key or Services ID rather than anything the
    // person at the browser did, so it is worth repeating verbatim in the log.
    const detail = await response.text().catch(() => "");
    throw new AppleAuthError(
      `Apple rejected the authorization code (${response.status}${
        detail ? `: ${detail.slice(0, 200)}` : ""
      }).`,
    );
  }

  const parsed = tokenResponseSchema.safeParse(await response.json());
  if (!parsed.success) {
    throw new AppleAuthError("Apple's token response contained no id_token.");
  }
  return parsed.data.id_token;
}

/**
 * Apple sends `email_verified` and `is_private_email` as booleans in some
 * responses and as the strings "true"/"false" in others. Both have always been
 * valid; a reader that assumes either one breaks on the other's day.
 */
const claimBoolean = z
  .union([z.boolean(), z.literal("true"), z.literal("false")])
  .transform((value) => value === true || value === "true");

const idTokenClaimsSchema = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  sub: z.string().min(1),
  exp: z.number(),
  iat: z.number(),
  nonce: z.string().optional(),
  email: z.string().optional(),
  email_verified: claimBoolean.optional(),
  is_private_email: claimBoolean.optional(),
});

const jwkSchema = z.object({
  kty: z.literal("RSA"),
  kid: z.string(),
  alg: z.string(),
  n: z.string(),
  e: z.string(),
});

const jwksSchema = z.object({ keys: z.array(jwkSchema) });

export type AppleJwk = z.infer<typeof jwkSchema>;

export interface AppleIdentity {
  /** Apple's `sub`: stable for this person and this developer team. */
  readonly subject: string;
  readonly email: string | null;
  readonly emailVerified: boolean;
  /** True when the address is an `@privaterelay.appleid.com` forwarder. */
  readonly isPrivateEmail: boolean;
}

let jwksCache: { keys: readonly AppleJwk[]; fetchedAt: number } | null = null;
/**
 * When the last *forced* refetch went out. Only forced ones are counted: an
 * ordinary cache miss is already limited by the TTL, and starting the cooldown
 * from it would block the one refetch that a key rotation depends on.
 */
let lastForcedFetch = Number.NEGATIVE_INFINITY;

async function fetchJwks(
  fetchImpl: typeof fetch,
): Promise<readonly AppleJwk[]> {
  let response: Response;
  try {
    response = await fetchImpl(JWKS_ENDPOINT, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AppleAuthError("Could not reach Apple's public key set.", {
      cause: error,
    });
  }
  if (!response.ok) {
    throw new AppleAuthError(
      `Apple's public key set answered ${response.status}.`,
    );
  }

  const parsed = jwksSchema.safeParse(await response.json());
  if (!parsed.success || parsed.data.keys.length === 0) {
    throw new AppleAuthError("Apple's public key set was not readable.");
  }
  return parsed.data.keys;
}

/**
 * Apple's signing keys, cached.
 *
 * `force` is for the one case that matters — a token whose `kid` is not in the
 * cache, which is what a key rotation looks like from here. The cooldown keeps
 * that from being a way to make this instance fetch on demand.
 */
export async function getAppleJwks(
  options: { force?: boolean; fetchImpl?: typeof fetch; now?: number } = {},
): Promise<readonly AppleJwk[]> {
  const now = options.now ?? Date.now();
  const cached = jwksCache;
  const fresh = cached && now - cached.fetchedAt < JWKS_TTL_MS;

  if (fresh && !options.force) return cached.keys;

  if (options.force) {
    if (cached && now - lastForcedFetch < JWKS_REFETCH_COOLDOWN_MS) {
      return cached.keys;
    }
    lastForcedFetch = now;
  }

  const keys = await fetchJwks(options.fetchImpl ?? fetch);
  jwksCache = { keys, fetchedAt: now };
  return keys;
}

/** Test hook, and used when the configuration is reloaded. */
export function resetAppleJwksCache(): void {
  jwksCache = null;
  lastForcedFetch = Number.NEGATIVE_INFINITY;
}

function decodeSegment(segment: string, label: string): unknown {
  try {
    return JSON.parse(Buffer.from(segment, "base64url").toString("utf8"));
  } catch (error) {
    throw new AppleAuthError(`The id_token's ${label} was not readable.`, {
      cause: error,
    });
  }
}

const headerSchema = z.object({
  alg: z.string(),
  kid: z.string(),
});

/**
 * Verifies an id_token and returns what it says.
 *
 * The order matters: the signature is checked against a key chosen only by
 * `kid`, and no claim is believed until it passes. The algorithm is pinned to
 * RS256 rather than read from the token, which is what stops the family of
 * attacks where a token nominates "none", or nominates HMAC so that a public
 * key gets used as a shared secret.
 */
export function verifyIdToken(
  idToken: string,
  {
    config,
    nonce,
    jwks,
    now = new Date(),
  }: {
    config: AppleConfig;
    /** The nonce this instance issued. A token without it is rejected. */
    nonce: string;
    jwks: readonly AppleJwk[];
    now?: Date;
  },
): AppleIdentity {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new AppleAuthError("The id_token was not a JWT.");
  }
  const [headerPart, payloadPart, signaturePart] = parts;

  const header = headerSchema.safeParse(decodeSegment(headerPart, "header"));
  if (!header.success) {
    throw new AppleAuthError("The id_token's header was not readable.");
  }
  if (header.data.alg !== "RS256") {
    throw new AppleAuthError(
      `The id_token is signed with "${header.data.alg}"; Apple signs with RS256.`,
    );
  }

  const jwk = jwks.find(
    (candidate) =>
      candidate.kid === header.data.kid && candidate.alg === "RS256",
  );
  if (!jwk) {
    throw new AppleAuthError(
      `No Apple public key matches the id_token's key ID "${header.data.kid}".`,
    );
  }

  let publicKey;
  try {
    publicKey = createPublicKey({ key: jwk, format: "jwk" });
  } catch (error) {
    throw new AppleAuthError("Apple's public key was not usable.", {
      cause: error,
    });
  }

  const signatureValid = verify(
    "sha256",
    Buffer.from(`${headerPart}.${payloadPart}`, "ascii"),
    { key: publicKey, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(signaturePart, "base64url"),
  );
  if (!signatureValid) {
    throw new AppleAuthError("The id_token's signature did not verify.");
  }

  const claims = idTokenClaimsSchema.safeParse(
    decodeSegment(payloadPart, "payload"),
  );
  if (!claims.success) {
    throw new AppleAuthError("The id_token was missing required claims.");
  }
  const payload = claims.data;

  if (payload.iss !== ISSUER) {
    throw new AppleAuthError(
      `The id_token was issued by "${payload.iss}", not ${ISSUER}.`,
    );
  }

  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(config.clientId)) {
    throw new AppleAuthError(
      "The id_token was issued for a different client than this instance.",
    );
  }

  const seconds = Math.floor(now.getTime() / 1000);
  if (payload.exp + CLOCK_SKEW_SECONDS < seconds) {
    throw new AppleAuthError("The id_token has expired.");
  }
  if (payload.iat - CLOCK_SKEW_SECONDS > seconds) {
    throw new AppleAuthError("The id_token was issued in the future.");
  }

  // A missing nonce is a replayed or injected token, not a lenient case: this
  // instance always sends one, so Apple always echoes one back.
  if (!payload.nonce || payload.nonce !== nonce) {
    throw new AppleAuthError(
      "The id_token's nonce did not match this sign-in.",
    );
  }

  const email = payload.email?.trim().toLowerCase() || null;
  return {
    subject: payload.sub,
    email,
    emailVerified: payload.email_verified ?? false,
    isPrivateEmail:
      payload.is_private_email ??
      email?.endsWith("@privaterelay.appleid.com") ??
      false,
  };
}

/**
 * The whole server-side exchange: code in, verified identity out.
 *
 * Retries once against a freshly fetched key set, because the one legitimate
 * reason a `kid` is unknown is that Apple rotated its keys since the last
 * fetch, and that should not cost anyone a failed sign-in.
 */
export async function completeAuthorization(
  config: AppleConfig,
  {
    code,
    nonce,
    now,
    fetchImpl,
  }: { code: string; nonce: string; now?: Date; fetchImpl?: typeof fetch },
): Promise<AppleIdentity> {
  const idToken = await exchangeAuthorizationCode(config, code, {
    now,
    fetchImpl,
  });

  const jwks = await getAppleJwks({ fetchImpl });
  try {
    return verifyIdToken(idToken, { config, nonce, jwks, now });
  } catch (error) {
    if (
      !(error instanceof AppleAuthError) ||
      !error.message.includes("key ID")
    ) {
      throw error;
    }
    const rotated = await getAppleJwks({ force: true, fetchImpl });
    return verifyIdToken(idToken, { config, nonce, jwks: rotated, now });
  }
}
