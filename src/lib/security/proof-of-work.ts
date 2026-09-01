import "server-only";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb, rowsAffected, type Database } from "@/lib/db/client";
import { proofOfWorkChallenges } from "@/lib/db/schema";
import { getEnv } from "@/lib/env";

/**
 * Making account creation cost something.
 *
 * Every other defence in front of signup is a *ceiling* — so many per address,
 * per inbox, per instance. Ceilings work against one attacker with one
 * connection and do nothing about the shape of the problem, which is that
 * creating an account is free and a botnet has more addresses than an operator
 * has patience. This is the other axis: before the server will look at a
 * signup, the client has to have spent a second of somebody's CPU.
 *
 * A second is nothing to a person filling in a form, who spent longer choosing
 * a password, and it is the whole game to a script opening ten thousand
 * accounts — which now needs three hours of compute per hour of attack.
 *
 * ## Why not a CAPTCHA
 *
 * The obvious alternatives are Turnstile and reCAPTCHA, and both are a third
 * party watching every visitor to an app whose entire pitch is that it is
 * yours. Neither can be run offline, both need an account somewhere, and a
 * self-hosted instance behind a VPN cannot reach either. A proof of work needs
 * nothing but the two ends already talking.
 *
 * It buys less than a CAPTCHA does — a determined attacker with rented GPUs
 * gets through, and it cannot tell a person from a script, only a cheap script
 * from an expensive one. That is the right trade here. The point is to price
 * bulk signup out, not to prove humanity.
 *
 * ## The protocol
 *
 * 1. The server picks a random `answer` below `maxNumber`, stores
 *    `SHA-256(nonce + answer)`, and sends back the nonce and the ceiling.
 * 2. The client counts from zero until the hash matches. There is no shortcut;
 *    on average it tries half the range.
 * 3. The client sends the number back with the signup. The server hashes it
 *    once — the asymmetry is the entire mechanism — and consumes the row.
 *
 * Off unless `SIGNUP_PROOF_OF_WORK` says otherwise, and it should stay off on
 * a private instance: `ALLOW_REGISTRATION=false` is a better answer there, and
 * costs the four people who use it nothing.
 */

/**
 * How much work a signup costs.
 *
 * The client hashes about half of this. Browsers manage somewhere between
 * fifty and two hundred thousand `crypto.subtle.digest` calls a second on a
 * phone, so this lands around a second — under the threshold where somebody
 * wonders whether the button worked, and enough that a signup flood needs real
 * hardware rather than a loop.
 *
 * Not configurable on purpose. An operator who needs to tune this needs a
 * different defence, and a number in a `.env` invites picking one that either
 * does nothing or breaks the form on an old phone.
 */
const MAX_NUMBER = 150_000;

/**
 * How long a challenge stays good for.
 *
 * Long enough to fill in a registration form unhurriedly, short enough that
 * the table stays small and a stockpile of pre-solved challenges is not worth
 * building.
 */
const CHALLENGE_TTL_MS = 15 * 60 * 1000;

/** What the client is told, and all it needs. */
export interface ProofOfWorkChallenge {
  /** Always SHA-256. Sent so the client is not hard-coding the server's mind. */
  readonly algorithm: "SHA-256";
  readonly nonce: string;
  /**
   * The hash to search for, hex encoded.
   *
   * Handing this out is the protocol, not a leak: finding the number behind it
   * is the work, and there is no way to it but through. What is never sent is
   * the number itself.
   */
  readonly challenge: string;
  readonly maxNumber: number;
}

/** The answer, as it comes back on a signup. */
export interface ProofOfWorkSolution {
  readonly nonce: string;
  readonly number: number;
}

/** Refused for want of a solved challenge. Translated via its `code`. */
export class ProofOfWorkError extends Error {
  readonly code = "proofOfWorkRequired";

  constructor() {
    super("This signup needs a completed browser verification.");
    this.name = "ProofOfWorkError";
  }
}

/** Whether this instance is asking for one at all. */
export function proofOfWorkEnabled(): boolean {
  return getEnv().SIGNUP_PROOF_OF_WORK;
}

function digest(nonce: string, answer: number): string {
  return createHash("sha256").update(`${nonce}${answer}`).digest("hex");
}

/** Mints a challenge and remembers what solves it. */
export async function issueProofOfWork(
  options: { db?: Database; now?: Date } = {},
): Promise<ProofOfWorkChallenge> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const nonce = randomBytes(16).toString("base64url");
  // Inclusive of the ceiling, so a client that stops at `maxNumber` and a
  // server that might have picked it agree.
  const answer = randomInt(0, MAX_NUMBER + 1);
  const answerHash = digest(nonce, answer);

  await db.insert(proofOfWorkChallenges).values({
    nonce,
    answerHash,
    maxNumber: MAX_NUMBER,
    expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
  });

  return {
    algorithm: "SHA-256",
    nonce,
    challenge: answerHash,
    maxNumber: MAX_NUMBER,
  };
}

/**
 * Checks an answer and spends the challenge.
 *
 * The consuming UPDATE is conditional on `consumed_at IS NULL` and the row
 * count decides, so two requests racing the same solved nonce cannot both
 * win — which is the replay this is guarding against, and the reason the
 * challenge is a row rather than a signature.
 */
export async function verifyProofOfWork(
  solution: ProofOfWorkSolution,
  options: { db?: Database; now?: Date } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  const [row] = await db
    .select({ answerHash: proofOfWorkChallenges.answerHash })
    .from(proofOfWorkChallenges)
    .where(
      and(
        eq(proofOfWorkChallenges.nonce, solution.nonce),
        isNull(proofOfWorkChallenges.consumedAt),
        gt(proofOfWorkChallenges.expiresAt, now),
      ),
    )
    .limit(1);

  if (!row) return false;
  // A plain comparison: both sides are hashes of values the client already
  // holds, so there is no secret here for a timing attack to walk out with.
  if (row.answerHash !== digest(solution.nonce, solution.number)) return false;

  const consumed = await db
    .update(proofOfWorkChallenges)
    .set({ consumedAt: now })
    .where(
      and(
        eq(proofOfWorkChallenges.nonce, solution.nonce),
        isNull(proofOfWorkChallenges.consumedAt),
      ),
    );

  return rowsAffected(consumed) === 1;
}

/**
 * The gate every signup door calls, whether or not the instance uses one.
 *
 * Returns without a word when the feature is off, so the four call sites read
 * the same either way and none of them has to know about the setting.
 */
export async function assertProofOfWork(
  solution: ProofOfWorkSolution | null | undefined,
  options: { db?: Database; now?: Date } = {},
): Promise<void> {
  if (!proofOfWorkEnabled()) return;
  if (!solution) throw new ProofOfWorkError();
  if (!(await verifyProofOfWork(solution, options))) {
    throw new ProofOfWorkError();
  }
}

/**
 * Drops challenges that can no longer be answered. Called by the maintenance
 * sweep, alongside the WebAuthn challenges this is modelled on.
 */
export async function pruneProofOfWorkChallenges(
  now: Date = new Date(),
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const result = await db
    .delete(proofOfWorkChallenges)
    .where(lt(proofOfWorkChallenges.expiresAt, now));
  return rowsAffected(result);
}

/** Squashes whatever arrived on the wire into a solution, or nothing. */
export function readProofOfWork(input: unknown): ProofOfWorkSolution | null {
  if (typeof input !== "object" || input === null) return null;
  const { nonce, number } = input as { nonce?: unknown; number?: unknown };
  if (typeof nonce !== "string" || nonce.length === 0) return null;
  if (typeof number !== "number" || !Number.isInteger(number)) return null;
  if (number < 0 || number > MAX_NUMBER) return null;
  return { nonce, number };
}

/** Exported for the tests, which should not have to restate the constants. */
export const PROOF_OF_WORK = {
  MAX_NUMBER,
  CHALLENGE_TTL_MS,
  digest,
} as const;
