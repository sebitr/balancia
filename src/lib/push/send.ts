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
import { isSendableEndpoint } from "@/lib/security/internal-hosts";
import { readCapped } from "@/lib/http/read-capped";

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

/**
 * Whether this endpoint's browser prints the web app's name for us.
 *
 * Safari does — on iOS and on macOS both, drawing a line under the title from
 * the manifest's `short_name`, which no push field can suppress. Chrome,
 * Edge and Firefox draw no such line, so on those a card that does not name
 * the app in its own title does not name it at all.
 *
 * Read from the push service rather than a user agent, because a user agent is
 * not something a push has: the subscription is all the sender has to go on.
 * The mapping is exact — a `web.push.apple.com` endpoint is issued to WebKit
 * and to nothing else.
 *
 * An endpoint that will not parse is treated as naming nothing, which is the
 * side that leaves a title complete rather than a card unattributed.
 */
export function drawsOwnAttribution(endpoint: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(endpoint).hostname.toLowerCase();
  } catch {
    return false;
  }
  return hostname === "push.apple.com" || hostname.endsWith(".push.apple.com");
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

/**
 * Longest one send may take, from connecting to the last byte of the reply.
 *
 * A push service answers as soon as it has queued the message — it does not
 * wait for the device — so a real one replies in well under a second, and one
 * that has not replied in ten is not about to. The endpoint is also whatever
 * a signed-in user subscribed with, so without a deadline of our own a server
 * that accepts the connection and never answers holds one of a delivery run's
 * eight slots for the five minutes undici waits by default, and eight such
 * subscriptions stall everybody else's notifications behind them. Ten seconds
 * is also about as long as anyone watching the "send a test" button will wait.
 */
const SEND_TIMEOUT_MS = 10_000;

/**
 * How much of a rejection's body is kept for the log.
 *
 * Push services explain a 400 in a sentence. Anything longer is read no
 * further: four bytes is the most one character takes in UTF-8, so the byte
 * cap always covers the characters kept, and the body can be as large as the
 * other end likes without any more of it reaching memory.
 */
const DETAIL_CHARS = 200;
const DETAIL_BYTES = DETAIL_CHARS * 4;

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
  /** Gives up sooner. `SEND_TIMEOUT_MS` applies whether or not this is set. */
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

  /*
   * The endpoint is checked again here, not only where it was stored.
   *
   * `subscriptionInputSchema` refuses an address inside the network, but it
   * only ever sees new subscriptions — rows written before that rule existed
   * are still in the table, and this is the function that would actually make
   * the request. Reported as `expired` so the caller deletes the row: an
   * endpoint that may not be called is not a device to keep trying.
   */
  if (!isSendableEndpoint(target.endpoint)) {
    return {
      status: "expired",
      reason: "Endpoint is not a public HTTPS address.",
    };
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

  // Our own deadline always applies, whether or not the caller brought a
  // signal. It covers the body too: an abort after the headers have arrived
  // errors the response stream, so a reply that trickles in is cut off at the
  // same moment as one that never starts.
  const deadline = AbortSignal.timeout(SEND_TIMEOUT_MS);
  const signal = options.signal
    ? AbortSignal.any([options.signal, deadline])
    : deadline;

  let response: Response;
  try {
    response = await fetch(target.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      signal,
      // A push service is a third party; never send or accept cookies.
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
  } catch (error) {
    // Slow is not the same as gone: the subscription is kept, and an endpoint
    // that stays this slow is retired by the failure count like any other.
    if (deadline.aborted) {
      return {
        status: "retry",
        reason: `Push service did not answer within ${SEND_TIMEOUT_MS / 1000} seconds.`,
      };
    }
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
  // and the message is about our own token, not about the recipient. Only a
  // little: the endpoint may be anybody's server, and its body anything.
  let detail = "";
  try {
    detail = (await readCapped(response, DETAIL_BYTES)).slice(0, DETAIL_CHARS);
  } catch {
    detail = "";
  }
  return {
    status: "failed",
    reason: `Push service returned ${response.status}${detail ? `: ${detail}` : ""}.`,
  };
}
