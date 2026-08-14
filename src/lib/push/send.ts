import "server-only";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { encryptPayload, type SubscriptionKeys } from "./encrypt";
import {
  assertValidKeyPair,
  authorizationFor,
  type VapidKeyPair,
} from "./vapid";
import { PushKeyError } from "./keys";

/**
 * Delivery of one encrypted message to one push endpoint.
 *
 * Everything above this layer deals in notifications; this deals in HTTP and
 * in the four answers a push service can give that actually change what the
 * caller should do next.
 */

export interface PushTarget extends SubscriptionKeys {
  readonly endpoint: string;
}

export type PushOutcome =
  /** Accepted for delivery. */
  | { readonly status: "sent" }
  /**
   * The subscription is gone — the browser was uninstalled, the permission
   * revoked, or the endpoint rotated. The row must be deleted, not retried.
   */
  | { readonly status: "expired"; readonly reason: string }
  /** Temporary: rate limited or the service is unwell. Worth retrying. */
  | {
      readonly status: "retry";
      readonly reason: string;
      readonly retryAfterSeconds?: number;
    }
  /** Permanent for this message: malformed payload, bad key, rejected token. */
  | { readonly status: "failed"; readonly reason: string };

/**
 * How long the push service should hold a message for a device that is
 * offline. Four hours: a notification about an expense is worth delivering
 * when someone opens their laptop after lunch, and worthless the next week.
 */
const DEFAULT_TTL_SECONDS = 4 * 60 * 60;

let cachedKeys: VapidKeyPair | null | undefined;

/**
 * The configured VAPID pair, or null when push is switched off.
 *
 * Validation happens once, here rather than in `env.ts`, because it needs
 * curve arithmetic to check the halves against each other — and because an
 * instance with a broken push key should still boot and serve the app.
 */
export function getVapidKeys(): VapidKeyPair | null {
  if (cachedKeys !== undefined) return cachedKeys;

  const env = getEnv();
  if (!env.pushEnabled) {
    cachedKeys = null;
    return cachedKeys;
  }

  const keys: VapidKeyPair = {
    publicKey: env.PUSH_VAPID_PUBLIC_KEY ?? "",
    privateKey: env.PUSH_VAPID_PRIVATE_KEY ?? "",
    subject:
      env.PUSH_VAPID_SUBJECT ?? `mailto:admin@${new URL(env.APP_URL).hostname}`,
  };

  try {
    assertValidKeyPair(keys);
  } catch (error) {
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Push notifications are configured but the VAPID keys are not usable; push is disabled",
    );
    cachedKeys = null;
    return cachedKeys;
  }

  cachedKeys = keys;
  return cachedKeys;
}

/** Test hook. */
export function resetPushKeys(): void {
  cachedKeys = undefined;
}

/** Whether this instance can send push messages at all. */
export function isPushConfigured(): boolean {
  return getVapidKeys() !== null;
}

function retryAfterSeconds(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number.parseInt(header, 10);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  const date = Date.parse(header);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.round((date - Date.now()) / 1000));
}

export interface SendPushOptions {
  readonly ttlSeconds?: number;
  /**
   * Collapse key. A later message with the same topic replaces an undelivered
   * earlier one, so a phone that was off all afternoon shows the current state
   * of a thing rather than six versions of it.
   */
  readonly topic?: string;
  readonly signal?: AbortSignal;
}

/**
 * Sends one message. Never throws for a delivery problem — the outcome is the
 * return value, because the caller has to record it against the subscription
 * either way.
 */
export async function sendPush(
  target: PushTarget,
  payload: string,
  options: SendPushOptions = {},
): Promise<PushOutcome> {
  const keys = getVapidKeys();
  if (!keys) {
    return { status: "failed", reason: "Push is not configured." };
  }

  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPayload(payload, target);
    authorization = authorizationFor(keys, target.endpoint);
  } catch (error) {
    // Bad subscription material or a bad endpoint: retrying cannot fix it.
    const reason = error instanceof Error ? error.message : String(error);
    return {
      status: error instanceof PushKeyError ? "expired" : "failed",
      reason,
    };
  }

  const headers: Record<string, string> = {
    Authorization: authorization,
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(options.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    // Balancia only sends things a person asked to be told about.
    Urgency: "normal",
  };
  if (options.topic) headers.Topic = options.topic;

  let response: Response;
  try {
    response = await fetch(target.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      signal: options.signal,
      // A push service is a third party; never send or accept cookies.
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    return {
      status: "retry",
      reason: error instanceof Error ? error.message : String(error),
    };
  }

  if (response.ok) return { status: "sent" };

  // 404 Not Found / 410 Gone: the subscription no longer exists.
  if (response.status === 404 || response.status === 410) {
    return {
      status: "expired",
      reason: `Push service returned ${response.status}.`,
    };
  }

  if (response.status === 429 || response.status >= 500) {
    return {
      status: "retry",
      reason: `Push service returned ${response.status}.`,
      retryAfterSeconds: retryAfterSeconds(response),
    };
  }

  // 400/401/403/413 and friends: our request was wrong, and will be wrong
  // again. Read a little of the body — push services explain themselves there,
  // and the message is about our own token, not about the recipient.
  let detail = "";
  try {
    detail = (await response.text()).slice(0, 200);
  } catch {
    detail = "";
  }
  return {
    status: "failed",
    reason: `Push service returned ${response.status}${detail ? `: ${detail}` : ""}.`,
  };
}
