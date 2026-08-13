import { sign } from "node:crypto";
import {
  decodeFixed,
  decodePublicKey,
  privateKeyObject,
  PRIVATE_KEY_BYTES,
  PushKeyError,
  publicKeyFromPrivate,
  toBase64Url,
} from "./keys";

/**
 * Voluntary Application Server Identification — RFC 8292.
 *
 * A push service will not accept a message without one: the JWT is how this
 * instance identifies itself as the sender that a subscription was created
 * for. The claim set is deliberately minimal — the audience, an expiry, and a
 * contact address the push service can use if the instance misbehaves. It says
 * nothing about the recipient.
 */

/**
 * Twelve hours. The RFC caps a token at 24; half of that leaves room for clock
 * skew at both ends while still letting one token serve a whole delivery run.
 */
const TOKEN_LIFETIME_SECONDS = 12 * 60 * 60;

/** Re-sign this long before expiry rather than racing it. */
const RENEW_BEFORE_SECONDS = 60 * 60;

export interface VapidKeyPair {
  /** base64url, 65-byte uncompressed point. Also the browser's applicationServerKey. */
  readonly publicKey: string;
  /** base64url, 32-byte scalar. */
  readonly privateKey: string;
  /** `mailto:` or `https:` contact for the push service operator. */
  readonly subject: string;
}

function base64UrlJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

/**
 * Validates a configured key pair.
 *
 * The halves are checked against each other, because a pair where only one
 * side was regenerated produces a token every push service rejects, and the
 * resulting 401s say nothing about the cause.
 */
export function assertValidKeyPair(keys: VapidKeyPair): void {
  const publicKey = decodePublicKey(keys.publicKey, "PUSH_VAPID_PUBLIC_KEY");
  const privateKey = decodeFixed(
    keys.privateKey,
    PRIVATE_KEY_BYTES,
    "PUSH_VAPID_PRIVATE_KEY",
  );

  if (!publicKeyFromPrivate(privateKey).equals(publicKey)) {
    throw new PushKeyError(
      "PUSH_VAPID_PUBLIC_KEY is not the public half of PUSH_VAPID_PRIVATE_KEY. " +
        "Generate a matching pair with `pnpm push:keys` and set both.",
    );
  }

  if (
    !keys.subject.startsWith("mailto:") &&
    !keys.subject.startsWith("https://")
  ) {
    throw new PushKeyError(
      'PUSH_VAPID_SUBJECT must be a "mailto:" address or an "https://" URL.',
    );
  }
}

/**
 * The `aud` claim: the origin of the push service, never the full endpoint.
 * The endpoint's path is the subscription identifier, and it does not belong
 * in a token the service logs.
 */
export function audienceFor(endpoint: string): string {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new PushKeyError("Push endpoint is not a valid URL.");
  }
  if (url.protocol !== "https:") {
    throw new PushKeyError("Push endpoint must be an https:// URL.");
  }
  return url.origin;
}

export interface VapidToken {
  readonly authorization: string;
  readonly expiresAt: number;
}

/**
 * Signs a VAPID token for one audience.
 *
 * ES256 signatures in JOSE are the raw r‖s pair, not the DER sequence Node
 * produces by default — hence `dsaEncoding`. Getting this wrong yields a
 * signature that verifies with OpenSSL and is rejected by every push service.
 */
export function signToken(
  keys: VapidKeyPair,
  audience: string,
  now: Date = new Date(),
): VapidToken {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + TOKEN_LIFETIME_SECONDS;

  const header = base64UrlJson({ typ: "JWT", alg: "ES256" });
  const payload = base64UrlJson({
    aud: audience,
    exp: expiresAt,
    sub: keys.subject,
  });
  const signingInput = `${header}.${payload}`;

  const privateKey = decodeFixed(
    keys.privateKey,
    PRIVATE_KEY_BYTES,
    "PUSH_VAPID_PRIVATE_KEY",
  );
  const signature = sign("sha256", Buffer.from(signingInput, "ascii"), {
    key: privateKeyObject(privateKey),
    dsaEncoding: "ieee-p1363",
  });

  return {
    authorization: `vapid t=${signingInput}.${toBase64Url(signature)}, k=${keys.publicKey}`,
    expiresAt,
  };
}

/**
 * Signed tokens, reused until they are close to expiring.
 *
 * Keyed by audience, so a delivery run that fans out to Google, Mozilla and
 * Apple endpoints signs three tokens rather than one per subscription. ECDSA
 * signing is not expensive, but a broadcast to a large group would otherwise
 * do it hundreds of times for no benefit.
 */
const tokenCache = new Map<string, VapidToken>();

export function authorizationFor(
  keys: VapidKeyPair,
  endpoint: string,
  now: Date = new Date(),
): string {
  const audience = audienceFor(endpoint);
  const cached = tokenCache.get(audience);
  const cutoff = Math.floor(now.getTime() / 1000) + RENEW_BEFORE_SECONDS;
  if (cached && cached.expiresAt > cutoff) {
    return cached.authorization;
  }

  const token = signToken(keys, audience, now);
  tokenCache.set(audience, token);
  return token.authorization;
}

/** Test hook, and used when the configuration is reloaded. */
export function resetTokenCache(): void {
  tokenCache.clear();
}
