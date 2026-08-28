import "server-only";
import { sql } from "drizzle-orm";
import { getDb, rowsAffected } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

/**
 * Fixed-window rate limiting backed by PostgreSQL.
 *
 * Balancia has no Redis by design, and a self-hosted instance rarely needs
 * more than this: one upsert per attempt, counted inside a window truncated to
 * a fixed boundary. Slightly more permissive than a sliding window at window
 * edges, which is an acceptable trade for having no extra moving part.
 */

export interface RateLimitPolicy {
  /** Maximum attempts allowed within the window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
}

export type RateLimitBucket =
  | "signIn"
  | "signUp"
  | "verifyCode"
  | "signInCode"
  | "guestRedeem"
  | "joinRedeem"
  | "passwordReset"
  | "emailChange"
  | "upload"
  | "receiptScan"
  | "rateLookup"
  | "pushSubscribe"
  | "pushTest"
  | "telemetryCrash"
  | "telemetryCrashTotal"
  | "telemetryTest"
  | "telemetryIngest";

/**
 * Default policies.
 *
 * The credential buckets are deliberately tight: they are what makes password
 * guessing and account enumeration expensive. `AUTH_RATE_LIMIT_MAX` raises the
 * credential limits for the one legitimate case where many attempts share an
 * address — an automated test suite against a private instance.
 */
function policies(): Record<RateLimitBucket, RateLimitPolicy> {
  const authMax = getEnv().AUTH_RATE_LIMIT_MAX;
  return {
    signIn: { limit: Math.max(10, authMax), windowSeconds: 300 },
    signUp: { limit: Math.max(5, authMax), windowSeconds: 3600 },
    /*
     * The tightest bucket in the set, and the one doing the most work.
     *
     * A six-digit code is a million possibilities, which is only out of reach
     * while the number of attempts is. Ten tries an hour against an address
     * covers a misread digit and a retype; walking the space at that rate
     * would take longer than the code's ten-minute life by five orders of
     * magnitude. Keyed by address rather than by IP, so one attacker cannot
     * spend everybody's allowance and lock a deployment out of its own codes.
     */
    verifyCode: { limit: Math.max(10, authMax), windowSeconds: 3600 },
    // Asking for a code mails a stranger's inbox on an unauthenticated say-so,
    // so it is held to the same ceiling as a password reset.
    signInCode: { limit: Math.max(5, authMax), windowSeconds: 3600 },
    passwordReset: { limit: Math.max(5, authMax), windowSeconds: 3600 },
    // Keyed by account rather than by address: each attempt mails a stranger's
    // inbox on a signed-in person's say-so, so the ceiling belongs to whoever
    // is asking. Room for a typo and a correction, not for a mail campaign.
    emailChange: { limit: Math.max(5, authMax), windowSeconds: 3600 },
    guestRedeem: { limit: 20, windowSeconds: 600 },
    // One group link is opened by everyone it was sent to, so the ceiling has
    // to clear a whole household on one address. Still far under what walking
    // the token space would need.
    joinRedeem: { limit: 40, windowSeconds: 600 },
    upload: { limit: 60, windowSeconds: 600 },
    // Tighter than `upload`, because each one is an outbound call the
    // operator is billed for. Enough to scan a dinner's worth of receipts and
    // retry the ones that came out wrong; not enough to run up a bill.
    receiptScan: { limit: 20, windowSeconds: 600 },
    // Generous: a form re-asks whenever the currency or date changes, and the
    // answers are cached, so this only has to stop outright abuse.
    rateLookup: { limit: 240, windowSeconds: 600 },
    // Subscribing happens once per device, plus the odd re-subscribe when a
    // browser rotates an endpoint.
    pushSubscribe: { limit: 30, windowSeconds: 600 },
    // A test notification costs an outbound request to a push service, so it
    // is the one notification endpoint worth keeping on a short leash.
    pushTest: { limit: 5, windowSeconds: 600 },
    // One report per error class per hour. The second occurrence of a failure
    // adds nothing the first did not say, and an instance in a crash loop must
    // not turn itself into a load generator.
    telemetryCrash: { limit: 1, windowSeconds: 3600 },
    // …and a ceiling across all classes, so a hundred *different* errors in an
    // hour is still a handful of requests.
    telemetryCrashTotal: { limit: 24, windowSeconds: 86_400 },
    // "Send test report" in the administration UI, per administrator.
    telemetryTest: { limit: 5, windowSeconds: 3600 },
    // The collector's own limit, keyed by a salted hash of the source address
    // rather than the address (see the telemetry ingest route). Generous: a
    // NAT or a university may legitimately be many installations.
    telemetryIngest: { limit: 60, windowSeconds: 3600 },
  };
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterSeconds: number;
}

function windowStart(policy: RateLimitPolicy, now: Date): Date {
  const windowMs = policy.windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * Records an attempt and reports whether it is allowed.
 *
 * `key` should identify the actor as narrowly as is safe — usually the client
 * IP, or the IP plus a token prefix. Never pass a raw token: this value is
 * stored.
 */
export async function consumeRateLimit(
  bucketName: RateLimitBucket,
  key: string,
  options: { now?: Date } = {},
): Promise<RateLimitResult> {
  const policy = policies()[bucketName];
  const now = options.now ?? new Date();
  const start = windowStart(policy, now);
  const bucket = `${bucketName}:${key}`;

  const db = getDb();
  const [row] = await db
    .insert(rateLimits)
    .values({ bucket, windowStart: start, count: 1, updatedAt: now })
    .onConflictDoUpdate({
      target: [rateLimits.bucket, rateLimits.windowStart],
      set: {
        count: sql`${rateLimits.count} + 1`,
        updatedAt: now,
      },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? 1;
  const allowed = count <= policy.limit;
  const windowEnd = start.getTime() + policy.windowSeconds * 1000;
  const retryAfterSeconds = Math.max(
    1,
    Math.ceil((windowEnd - now.getTime()) / 1000),
  );

  return {
    allowed,
    remaining: Math.max(0, policy.limit - count),
    retryAfterSeconds: allowed ? 0 : retryAfterSeconds,
  };
}

/** Deletes windows that can no longer be hit. Called by a scheduled job. */
export async function pruneRateLimits(olderThan: Date): Promise<number> {
  const db = getDb();
  const result = await db
    .delete(rateLimits)
    .where(sql`${rateLimits.windowStart} < ${olderThan}`);
  return rowsAffected(result);
}

export class RateLimitedError extends Error {
  /** Translated by the Server Action funnel; see `lib/actions.ts`. */
  readonly code = "rateLimited";

  constructor(readonly retryAfterSeconds: number) {
    super("Too many attempts. Please try again later.");
    this.name = "RateLimitedError";
  }
}
