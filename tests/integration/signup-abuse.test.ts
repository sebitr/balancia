import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { passkeys, proofOfWorkChallenges, users } from "@/lib/db/schema";
import { getEnv, resetEnvCache } from "@/lib/env";
import {
  enforceSignUpLimits,
  RateLimitedError,
} from "@/lib/security/rate-limit";
import {
  issueProofOfWork,
  PROOF_OF_WORK,
  pruneProofOfWorkChallenges,
  readProofOfWork,
  verifyProofOfWork,
} from "@/lib/security/proof-of-work";
import { createSession } from "@/modules/auth/sessions";
import { pruneUnclaimedAccounts } from "@/modules/auth/signup";
import { createTestUser, createTestGroup } from "../helpers/factories";

/**
 * The defences in front of account creation, end to end against a real
 * database — which is the only place three of them exist at all: a rate-limit
 * window, a challenge row and a DELETE with five NOT EXISTS clauses are not
 * things a unit test can say anything true about.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/**
 * The reaper refuses to run without a mail server, so every test of it has to
 * pretend there is one. Restored afterwards, or the rest of the file — and any
 * file after it in the same worker — would be looking at a different instance
 * than it thinks.
 */
function withSmtp(enabled: boolean): void {
  if (enabled) {
    process.env.SMTP_HOST = "localhost";
    process.env.SMTP_PORT = "1025";
    process.env.SMTP_FROM = "balancia@example.test";
  } else {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_FROM;
  }
  resetEnvCache();
}

afterEach(() => {
  withSmtp(false);
});

/** An account begun and never proved: no credential, no session, no group. */
async function unclaimedAccount(email: string, ageMs: number): Promise<string> {
  const db = getDb();
  const createdAt = new Date(Date.now() - ageMs);
  const [created] = await db
    .insert(users)
    .values({ email, name: "Somebody", createdAt, updatedAt: createdAt })
    .returning({ id: users.id });
  return created!.id;
}

async function stillThere(userId: string): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row !== undefined;
}

describe("pruneUnclaimedAccounts", () => {
  beforeEach(() => {
    withSmtp(true);
  });

  it("frees an address somebody claimed and never proved", async () => {
    const squatted = await unclaimedAccount("victim@corp.test", 2 * DAY);

    expect(await pruneUnclaimedAccounts()).toBe(1);
    expect(await stillThere(squatted)).toBe(false);
  });

  it("leaves the confirmation mail time to be read", async () => {
    const fresh = await unclaimedAccount("fresh@corp.test", 2 * HOUR);

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(fresh)).toBe(true);
  });

  it("never touches anything older than a week", async () => {
    // The guard against switching SMTP on for the first time on an instance
    // where every account is unverified by construction.
    const ancient = await unclaimedAccount("ancient@corp.test", 90 * DAY);

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(ancient)).toBe(true);
  });

  it("does nothing at all without a mail server", async () => {
    withSmtp(false);
    expect(getEnv().smtpEnabled).toBe(false);
    const unverified = await unclaimedAccount("nosmtp@corp.test", 2 * DAY);

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(unverified)).toBe(true);
  });

  it("spares an account that ever had a session", async () => {
    const arrived = await unclaimedAccount("arrived@corp.test", 2 * DAY);
    await createSession(arrived, {});

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(arrived)).toBe(true);
  });

  it("spares an account whose credential is a passkey", async () => {
    // The passkey signup leaves the address unverified on purpose: the
    // authenticator is the proof, and there is nothing to reap.
    const withPasskey = await unclaimedAccount("passkey@corp.test", 2 * DAY);
    await getDb().insert(passkeys).values({
      userId: withPasskey,
      credentialId: "credential-id",
      publicKey: "public-key",
    });

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(withPasskey)).toBe(true);
  });

  it("spares an account that is in a group", async () => {
    const member = await createTestUser({ email: "member@corp.test" });
    await createTestGroup(member);
    // Backdate it and unverify it, so only the membership stands between this
    // account and the sweep.
    await getDb()
      .update(users)
      .set({
        emailVerifiedAt: null,
        createdAt: new Date(Date.now() - 2 * DAY),
      })
      .where(eq(users.id, member.userId));

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(member.userId)).toBe(true);
  });

  it("spares the instance administrator", async () => {
    const admin = await unclaimedAccount("admin@corp.test", 2 * DAY);
    await getDb()
      .update(users)
      .set({ isAdmin: true })
      .where(eq(users.id, admin));

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(admin)).toBe(true);
  });

  it("leaves a verified account alone whatever else is true of it", async () => {
    const db = getDb();
    const createdAt = new Date(Date.now() - 2 * DAY);
    const [verified] = await db
      .insert(users)
      .values({
        email: "verified@corp.test",
        name: "Somebody",
        createdAt,
        updatedAt: createdAt,
        emailVerifiedAt: createdAt,
      })
      .returning({ id: users.id });

    expect(await pruneUnclaimedAccounts()).toBe(0);
    expect(await stillThere(verified!.id)).toBe(true);
  });
});

describe("enforceSignUpLimits", () => {
  it("stops one address being mailed over and over from anywhere", async () => {
    // Three a day, and a fresh IP every time — which is exactly the shape of
    // an attack that keys on the sender cannot see.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await enforceSignUpLimits(`10.0.0.${attempt}`, "victim@corp.test");
    }

    await expect(
      enforceSignUpLimits("10.0.0.99", "victim@corp.test"),
    ).rejects.toThrow(RateLimitedError);
  });

  it("counts the address case-insensitively", async () => {
    await enforceSignUpLimits("10.0.1.1", "Victim@Corp.Test");
    await enforceSignUpLimits("10.0.1.2", "VICTIM@CORP.TEST");
    await enforceSignUpLimits("10.0.1.3", " victim@corp.test ");

    await expect(
      enforceSignUpLimits("10.0.1.4", "victim@corp.test"),
    ).rejects.toThrow(RateLimitedError);
  });

  it("holds a ceiling across the whole instance", async () => {
    // Fifty an hour, every one from a different address and to a different
    // inbox, so neither of the other two buckets is what refuses the last.
    let refused = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      try {
        await enforceSignUpLimits(
          `10.1.${attempt}.1`,
          `nobody-${attempt}@x.test`,
        );
      } catch (error) {
        if (!(error instanceof RateLimitedError)) throw error;
        refused += 1;
      }
    }

    expect(refused).toBeGreaterThan(0);
  });

  it("still refuses a single address hammering from one place", async () => {
    // Thirty an hour per IP — a household on one wifi, not five. Each attempt
    // names a different inbox so the per-address bucket stays clear.
    let refused = 0;
    for (let attempt = 0; attempt < 33; attempt += 1) {
      try {
        await enforceSignUpLimits("10.2.0.1", `nobody-${attempt}@x.test`);
      } catch (error) {
        if (!(error instanceof RateLimitedError)) throw error;
        refused += 1;
      }
    }

    expect(refused).toBe(3);
  });

  it("says how long to wait, in whole minutes", async () => {
    // "Try again later" is not an instruction anybody can follow; the bucket
    // knows when its window ends, and the refusal carries it.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await enforceSignUpLimits(`10.3.0.${attempt}`, "waiting@corp.test");
    }

    const refusal = await enforceSignUpLimits(
      "10.3.0.9",
      "waiting@corp.test",
    ).catch((error: unknown) => error);

    expect(refusal).toBeInstanceOf(RateLimitedError);
    const limited = refusal as RateLimitedError;
    expect(limited.retryAfterSeconds).toBeGreaterThan(0);
    expect(limited.params.minutes).toBeGreaterThanOrEqual(1);
    expect(limited.params.minutes).toBe(
      Math.ceil(limited.retryAfterSeconds / 60),
    );
    expect(limited.message).toContain(`${limited.params.minutes} minute`);
  });
});

describe("proof of work", () => {
  /** What an honest client does: count until the hash matches. */
  function solve(nonce: string, target: string, maxNumber: number): number {
    for (let candidate = 0; candidate <= maxNumber; candidate += 1) {
      if (PROOF_OF_WORK.digest(nonce, candidate) === target) return candidate;
    }
    throw new Error("the challenge had no answer below its own ceiling");
  }

  it("accepts the answer it set, exactly once", async () => {
    const challenge = await issueProofOfWork();
    const number = solve(
      challenge.nonce,
      challenge.challenge,
      challenge.maxNumber,
    );

    expect(await verifyProofOfWork({ nonce: challenge.nonce, number })).toBe(
      true,
    );
    // The replay. Without this the work is paid once and spent for ever, which
    // is the same as not asking for it.
    expect(await verifyProofOfWork({ nonce: challenge.nonce, number })).toBe(
      false,
    );
  });

  it("refuses a number that is not the answer", async () => {
    const challenge = await issueProofOfWork();
    const number = solve(
      challenge.nonce,
      challenge.challenge,
      challenge.maxNumber,
    );

    expect(
      await verifyProofOfWork({ nonce: challenge.nonce, number: number + 1 }),
    ).toBe(false);
    // And the real answer still works afterwards: a wrong guess must not burn
    // somebody's challenge.
    expect(await verifyProofOfWork({ nonce: challenge.nonce, number })).toBe(
      true,
    );
  });

  it("refuses a nonce nobody issued", async () => {
    expect(
      await verifyProofOfWork({ nonce: "not-a-real-nonce", number: 1 }),
    ).toBe(false);
  });

  it("refuses one that has expired, and prunes it", async () => {
    const challenge = await issueProofOfWork();
    const number = solve(
      challenge.nonce,
      challenge.challenge,
      challenge.maxNumber,
    );
    const later = new Date(Date.now() + PROOF_OF_WORK.CHALLENGE_TTL_MS + 1000);

    expect(
      await verifyProofOfWork(
        { nonce: challenge.nonce, number },
        { now: later },
      ),
    ).toBe(false);

    expect(await pruneProofOfWorkChallenges(later)).toBe(1);
    const [remaining] = await getDb()
      .select({ count: sql<number>`count(*)::int` })
      .from(proofOfWorkChallenges);
    expect(remaining?.count).toBe(0);
  });
});

describe("readProofOfWork", () => {
  it("takes a well-formed answer and nothing else", () => {
    expect(readProofOfWork({ nonce: "abc", number: 12 })).toEqual({
      nonce: "abc",
      number: 12,
    });

    for (const rubbish of [
      null,
      undefined,
      "nonce=abc",
      { nonce: "", number: 1 },
      { nonce: "abc" },
      { nonce: "abc", number: -1 },
      { nonce: "abc", number: 1.5 },
      { nonce: "abc", number: PROOF_OF_WORK.MAX_NUMBER + 1 },
    ]) {
      expect(readProofOfWork(rubbish), JSON.stringify(rubbish)).toBeNull();
    }
  });
});
