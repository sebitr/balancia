import "server-only";
import { sql } from "drizzle-orm";
import { getDb, rowsAffected } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";
import { rateLimitRefusals } from "@/lib/metrics/metrics";

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
  | "signUpEmail"
  | "signUpTotal"
  | "proofOfWork"
  | "verifyCode"
  | "signInCode"
  | "guestRedeem"
  | "guestGroup"
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
    /*
     * Per address, and an address is a household: the people a group's link
     * is sent to are at one table, on one wifi, and they all sign up in the
     * same ten minutes. Five an hour refused the sixth of them with "Too many
     * attempts". Thirty clears any dinner and is still a rounding error next
     * to walking anything; the per-inbox and instance-wide ceilings below are
     * what actually stand in front of abuse.
     */
    signUp: { limit: Math.max(30, authMax), windowSeconds: 3600 },
    /*
     * The same ceiling, keyed on the address being signed up rather than on
     * whoever is asking.
     *
     * Every door here mails the address the *caller* typed — a confirmation
     * link or a six-digit code — so an unauthenticated stranger decides who
     * this instance writes to. Keyed by IP alone that is a mail cannon: a
     * modest pool of addresses buys five sends an hour each, all of them at
     * one inbox, and the reputation it costs is the operator's SMTP domain.
     * Keyed by recipient it cannot be aimed, however many addresses the
     * sender has.
     *
     * Wider than a day would strand somebody who genuinely mistyped twice;
     * three is enough for a typo and a correction and no kind of campaign.
     */
    signUpEmail: { limit: Math.max(3, authMax), windowSeconds: 86_400 },
    /*
     * And a ceiling across the whole instance, keyed on nothing.
     *
     * The two buckets above both assume the attacker is scarce in something —
     * addresses, or targets. A botnet is scarce in neither, and without a
     * total there is no number of accounts an instance cannot be made to
     * create overnight. Fifty an hour is far above what any self-hosted
     * deployment sees and far below what makes the database somebody's
     * plaything; `AUTH_RATE_LIMIT_MAX` lifts it for the test suite that
     * legitimately needs more.
     */
    signUpTotal: { limit: Math.max(50, authMax), windowSeconds: 3600 },
    // Handing out proof-of-work challenges is cheap but not free — each one is
    // a row. Generous enough that a reloaded form never notices.
    proofOfWork: { limit: Math.max(60, authMax), windowSeconds: 3600 },
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
    // Starting a group with no account writes a group, a participant, a
    // link and an invitation on nobody's say-so. Ten an hour from one place
    // is a household trying it out; a bot writing rows is what this refuses.
    guestGroup: { limit: 10, windowSeconds: 3600 },
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
  // The bucket name is a literal from the union above, so this label is
  // bounded like every other one. Counted here rather than at the call sites
  // because a refusal nobody records is an attack nobody sees: this is the
  // only place that knows a limit was hit.
  if (!allowed) rateLimitRefusals().increment({ bucket: bucketName });
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
  /**
   * Translated by the Server Action funnel; see `lib/actions.ts` and
   * `lib/server-errors.ts`, which reads `params` for the sentence's number.
   */
  readonly code = "rateLimitedFor";
  /** How long to wait, rounded up to whole minutes: "try again later" is
   * not an instruction anybody can follow, and the bucket knows the answer. */
  readonly params: { readonly minutes: number };

  constructor(readonly retryAfterSeconds: number) {
    const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
    super(
      `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
    );
    this.name = "RateLimitedError";
    this.params = { minutes };
  }
}

/**
 * The three ceilings account creation stands behind, spent in one call.
 *
 * Reached through `security/signup-guard.ts` rather than directly, which is
 * what keeps the four front doors — the web form, the mobile API, the passkey
 * ceremony and the emailed code — behind the same policy. One of them growing
 * a limit the others did not is the failure this shape exists to prevent.
 *
 * The instance ceiling goes first, so a flood cannot also burn through the two
 * narrower allowances on its way to being refused.
 */
export async function enforceSignUpLimits(
  ipAddress: string,
  email: string,
): Promise<void> {
  const attempts: readonly [RateLimitBucket, string][] = [
    ["signUpTotal", "instance"],
    ["signUp", ipAddress],
    // Lowercased, never normalised further: this is a rate-limit key, not an
    // identity, and it must not need the auth module to compute.
    ["signUpEmail", email.trim().toLowerCase()],
  ];

  for (const [bucket, key] of attempts) {
    const limit = await consumeRateLimit(bucket, key);
    if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
  }
}
