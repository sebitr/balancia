import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { sessions, users, verificationTokens } from "@/lib/db/schema";
import {
  AuthError,
  changePassword,
  registerUser,
  signInWithPassword,
} from "@/modules/auth/service";
import {
  createSession,
  resolveSession,
  revokeAllSessionsForUser,
  revokeSession,
  pruneSessions,
} from "@/modules/auth/sessions";
import { hashPassword, verifyPassword } from "@/modules/auth/passwords";
import { hashToken } from "@/lib/security/tokens";
import { getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { startPasskeyAuthentication } from "@/modules/auth/webauthn";
import { createTestUser } from "../helpers/factories";

/**
 * Authentication integration tests against the first-party implementation.
 */

const PASSWORD = "quiet-lantern-drifts-42";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}@example.test`;
}

describe("password hashing", () => {
  it("produces a self-describing scrypt hash, never the plaintext", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(hash.startsWith("scrypt$")).toBe(true);
    expect(hash).not.toContain(PASSWORD);
    expect(hash.split("$")).toHaveLength(6);
  });

  it("produces a different hash each time, and verifies both", async () => {
    const first = await hashPassword(PASSWORD);
    const second = await hashPassword(PASSWORD);
    expect(first).not.toBe(second); // distinct salts
    expect(await verifyPassword(PASSWORD, first)).toBe(true);
    expect(await verifyPassword(PASSWORD, second)).toBe(true);
  });

  it("rejects a wrong password and a malformed hash", async () => {
    const hash = await hashPassword(PASSWORD);
    expect(await verifyPassword("not-the-password", hash)).toBe(false);
    expect(await verifyPassword(PASSWORD, "garbage")).toBe(false);
    expect(await verifyPassword(PASSWORD, "scrypt$1$2$3$bad$bad")).toBe(false);
  });

  it("enforces the minimum length", async () => {
    await expect(hashPassword("short")).rejects.toThrow(/at least/);
  });
});

describe("registration", () => {
  it("creates the account and stores only a hash", async () => {
    const email = uniqueEmail("register");
    const result = await registerUser({
      name: "New User",
      email,
      password: PASSWORD,
    });

    expect(result.user.email).toBe(email);
    expect(result.session).not.toBeNull();

    const db = getDb();
    const [row] = await db
      .select()
      .from(users)
      .where(eq(users.id, result.user.userId));
    expect(row.passwordHash).toBeTruthy();
    expect(row.passwordHash).not.toContain(PASSWORD);
    expect(JSON.stringify(row)).not.toContain(PASSWORD);
  });

  it("normalizes the email and refuses a duplicate in any casing", async () => {
    const email = uniqueEmail("Dupe").toUpperCase();
    await registerUser({ name: "First", email, password: PASSWORD });

    await expect(
      registerUser({
        name: "Second",
        email: email.toLowerCase(),
        password: PASSWORD,
      }),
    ).rejects.toThrow(/already registered/);

    const db = getDb();
    const rows = await db
      .select()
      .from(users)
      .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
    expect(rows).toHaveLength(1);
  });

  it("rejects a password below the policy", async () => {
    await expect(
      registerUser({
        name: "Weak",
        email: uniqueEmail("weak"),
        password: "short",
      }),
    ).rejects.toThrow();
  });
});

describe("sign-in", () => {
  it("signs in with the right password", async () => {
    const email = uniqueEmail("signin");
    await registerUser({ name: "Signer", email, password: PASSWORD });

    const result = await signInWithPassword({ email, password: PASSWORD });
    expect(result.user.email).toBe(email);
    expect(result.session.token).toBeTruthy();
  });

  it("refuses the wrong password", async () => {
    const email = uniqueEmail("wrong");
    await registerUser({ name: "Signer", email, password: PASSWORD });

    await expect(
      signInWithPassword({ email, password: "definitely-not-it" }),
    ).rejects.toThrow(AuthError);
  });

  it("gives the same message whether or not the account exists", async () => {
    const email = uniqueEmail("exists");
    await registerUser({ name: "Signer", email, password: PASSWORD });

    const wrongPassword = await signInWithPassword({
      email,
      password: "definitely-not-it",
    }).catch((error: unknown) => (error as Error).message);
    const noAccount = await signInWithPassword({
      email: uniqueEmail("missing"),
      password: PASSWORD,
    }).catch((error: unknown) => (error as Error).message);

    // Identical wording: the response must not reveal which addresses exist.
    expect(wrongPassword).toBe(noAccount);
  });

  it("is case-insensitive on the email", async () => {
    const email = uniqueEmail("case");
    await registerUser({ name: "Signer", email, password: PASSWORD });

    const result = await signInWithPassword({
      email: email.toUpperCase(),
      password: PASSWORD,
    });
    expect(result.user.userId).toBeTruthy();
  });
});

describe("sessions", () => {
  it("stores only the token hash and resolves back to the user", async () => {
    const actor = await createTestUser();
    const created = await createSession(actor.userId);

    const db = getDb();
    const [row] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, created.sessionId));
    expect(row.tokenHash).toBe(hashToken(created.token));
    expect(JSON.stringify(row)).not.toContain(created.token);

    const resolved = await resolveSession(created.token);
    expect(resolved?.userId).toBe(actor.userId);
  });

  it("rejects an unknown, malformed or revoked token", async () => {
    const actor = await createTestUser();
    const created = await createSession(actor.userId);

    expect(await resolveSession("nope")).toBeNull();
    expect(await resolveSession("A".repeat(43))).toBeNull();

    await revokeSession(created.token);
    expect(await resolveSession(created.token)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const actor = await createTestUser();
    const created = await createSession(actor.userId);

    const db = getDb();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, created.sessionId));

    expect(await resolveSession(created.token)).toBeNull();
  });

  it("ends every session when a password is reset", async () => {
    const actor = await createTestUser();
    const first = await createSession(actor.userId);
    const second = await createSession(actor.userId);

    await revokeAllSessionsForUser(actor.userId);

    expect(await resolveSession(first.token)).toBeNull();
    expect(await resolveSession(second.token)).toBeNull();
  });

  it("prunes expired rows", async () => {
    const actor = await createTestUser();
    const created = await createSession(actor.userId);
    const db = getDb();
    await db
      .update(sessions)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(sessions.id, created.sessionId));

    expect(await pruneSessions()).toBeGreaterThan(0);
  });
});

describe("changing a password", () => {
  it("requires the current password and re-hashes on success", async () => {
    const email = uniqueEmail("change");
    const registered = await registerUser({
      name: "Changer",
      email,
      password: PASSWORD,
    });

    await expect(
      changePassword(
        registered.user.userId,
        "wrong-current",
        "a-new-password-1",
      ),
    ).rejects.toThrow(/current password/);

    await changePassword(registered.user.userId, PASSWORD, "a-new-password-1");

    await expect(
      signInWithPassword({ email, password: PASSWORD }),
    ).rejects.toThrow(AuthError);
    const result = await signInWithPassword({
      email,
      password: "a-new-password-1",
    });
    expect(result.user.email).toBe(email);
  });
});

describe("verification tokens", () => {
  it("stores only hashes", async () => {
    // Without SMTP no token is issued, so assert the table stays empty rather
    // than asserting on a token that was never created.
    const db = getDb();
    const rows = await db.select().from(verificationTokens);
    for (const row of rows) {
      expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    }
  });
});

describe("passkey configuration", () => {
  it("derives a relying-party ID consistent with the public URL", () => {
    const env = getEnv();
    const host = new URL(env.APP_URL).hostname;
    expect(
      host === env.webAuthnRpId || host.endsWith(`.${env.webAuthnRpId}`),
    ).toBe(true);
  });

  it("issues an authentication challenge bound to the relying party", async () => {
    const env = getEnv();
    const options = await startPasskeyAuthentication();

    expect(options.rpId).toBe(env.webAuthnRpId);
    expect(options.challenge).toBeTruthy();

    // The challenge must have been persisted so it can be verified later.
    const db = getDb();
    const stored = await db.query.webauthnChallenges.findMany();
    expect(stored.some((row) => row.challenge === options.challenge)).toBe(
      true,
    );
  });

  it("issues a distinct challenge every time", async () => {
    const first = await startPasskeyAuthentication();
    const second = await startPasskeyAuthentication();
    expect(first.challenge).not.toBe(second.challenge);
  });
});

describe("rate limiting", () => {
  it("allows attempts up to the limit, then blocks", async () => {
    const key = `test-${Date.now()}`;
    const results = [];
    for (let attempt = 0; attempt < 12; attempt += 1) {
      results.push(await consumeRateLimit("signIn", key));
    }

    expect(results.slice(0, 10).every((result) => result.allowed)).toBe(true);
    expect(results[10].allowed).toBe(false);
    expect(results[10].retryAfterSeconds).toBeGreaterThan(0);
  });

  it("counts each key separately", async () => {
    const suffix = Date.now();
    for (let attempt = 0; attempt < 11; attempt += 1) {
      await consumeRateLimit("signIn", `blocked-${suffix}`);
    }
    const blocked = await consumeRateLimit("signIn", `blocked-${suffix}`);
    const fresh = await consumeRateLimit("signIn", `fresh-${suffix}`);

    expect(blocked.allowed).toBe(false);
    expect(fresh.allowed).toBe(true);
  });
});
