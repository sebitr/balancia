import "server-only";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";
import { open, seal } from "@/lib/security/secret-box";
import { isOAuthKind, type OAuthKind } from "./oauth";
import { oauthAppSchema } from "./providers";

/**
 * What the browser carries to the provider and back.
 *
 * A person leaves for Google's page and returns minutes later on a fresh
 * request. Three things have to survive the trip and must not be forgeable:
 * the `state` the provider echoes (so the way back belongs to the way out),
 * the PKCE verifier (so a stolen code is worthless), and *whose* connection
 * this is (so a code obtained in one session cannot be completed in another).
 *
 * They ride in one cookie, sealed with the same AES-GCM box the credentials
 * use, so it cannot be read or edited by the page, and it is deleted the moment
 * it is read: an abandoned or failed attempt cannot be replayed with a second
 * code. `SameSite=Lax` is enough, unlike Apple's form-post — the provider
 * returns by a plain redirect, a top-level GET, which Lax cookies accompany.
 */

export const COOKIE_NAME = "balancia_backup_oauth";
export const COOKIE_PATH = "/api/backup/oauth";
export const COOKIE_TTL_SECONDS = 10 * 60;
const PURPOSE = "backup-oauth-state";

export interface PendingConnection {
  readonly kind: OAuthKind;
  readonly state: string;
  readonly verifier: string;
  readonly userId: string;
  /** Set when reconnecting an existing destination rather than adding one. */
  readonly reconnectId?: string;
  /**
   * The person's own app, when they are connecting through one. The callback
   * needs the secret to trade the code for tokens, and the page that typed it
   * is gone by then, so it rides here — sealed with everything else, readable
   * by nobody who holds the cookie, and burned when read.
   */
  readonly app?: { readonly clientId: string; readonly clientSecret: string };
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export function encodePending(pending: PendingConnection): string {
  return seal(PURPOSE, JSON.stringify(pending));
}

export function decodePending(
  value: string | undefined,
  now = Date.now(),
): PendingConnection | null {
  const plain = open(PURPOSE, value ?? null);
  if (plain === null) return null;
  try {
    const parsed = JSON.parse(plain) as Partial<PendingConnection>;
    if (
      typeof parsed.kind !== "string" ||
      !isOAuthKind(parsed.kind) ||
      typeof parsed.state !== "string" ||
      typeof parsed.verifier !== "string" ||
      typeof parsed.userId !== "string" ||
      typeof parsed.expiresAt !== "number" ||
      parsed.expiresAt < now
    ) {
      return null;
    }
    // Both halves or neither: one without the other cannot sign anything.
    const app = oauthAppSchema.safeParse(parsed.app);
    return {
      kind: parsed.kind,
      state: parsed.state,
      verifier: parsed.verifier,
      userId: parsed.userId,
      reconnectId:
        typeof parsed.reconnectId === "string" ? parsed.reconnectId : undefined,
      app: app.success ? app.data : undefined,
      expiresAt: parsed.expiresAt,
    };
  } catch {
    return null;
  }
}

export function ttlExpiry(now = Date.now()): number {
  return now + COOKIE_TTL_SECONDS * 1000;
}

export function sameState(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * The cookie's attributes, for the route layer that sets it. `Secure` follows
 * the public URL, because browsers refuse a Secure cookie over plain HTTP and a
 * development instance is one.
 */
export function cookieAttributes(maxAge: number) {
  return {
    httpOnly: true,
    secure: getEnv().appOrigin.startsWith("https://"),
    sameSite: "lax" as const,
    path: COOKIE_PATH,
    maxAge,
  };
}
