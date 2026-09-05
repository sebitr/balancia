import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users, webauthnChallenges } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  hasProvisionalName,
  registerUser,
  saveUserName,
  signInWithApple,
} from "@/modules/auth/service";
import { startCodeSignup, startPasskeySignup } from "@/modules/auth/signup";

/**
 * Which accounts the dashboard is allowed to ask about their name.
 *
 * Two signups write the row before anything has asked what to call it, so
 * something has to remember that nobody was ever asked. It used to be a guess
 * made on every render — the name against the address's local part — and the
 * reader it was wrong about was the one it nagged: somebody called Seb whose
 * address is seb@ can never satisfy a comparison like that, and the card had
 * no way to be dismissed. The stamp below is the whole of the fix, so the
 * cases that matter here are the ones where the guess and the truth disagree.
 */

vi.mock("@/modules/auth/mailer", () => ({
  sendMail: vi.fn(async () => undefined),
}));

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

beforeEach(() => withSmtp(true));
afterEach(() => withSmtp(false));

async function rowFor(email: string) {
  const [row] = await getDb()
    .select({ name: users.name, nameChosenAt: users.nameChosenAt })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
  return row!;
}

describe("a signup that was never asked for a name", () => {
  it("stands the local part in and leaves the account unnamed", async () => {
    const email = `cold-${Date.now()}@example.test`;

    const { userId } = await startCodeSignup({ email, name: null });

    const row = await rowFor(email);
    expect(row.name).toBe(email.split("@")[0]);
    expect(row.nameChosenAt).toBeNull();
    expect(await hasProvisionalName(userId)).toBe(true);
  });

  it("stops being unnamed the moment somebody saves one", async () => {
    const email = `named-later-${Date.now()}@example.test`;
    const { userId } = await startCodeSignup({ email, name: null });

    await saveUserName(userId, "Ada Lovelace");

    expect((await rowFor(email)).nameChosenAt).not.toBeNull();
    expect(await hasProvisionalName(userId)).toBe(false);
  });
});

describe("a name somebody typed", () => {
  it("is never a placeholder, even when it is the address's local part", async () => {
    // The bug this column exists for. Both spellings: the report came from a
    // "Seb" at seb@, and the exact-case version is the one no comparison of
    // any kind could ever have got right.
    for (const typed of ["Seb", "seb"]) {
      // The local part is exactly "seb"; only the domain keeps the two rows
      // apart, so the name and the local part really are the same string.
      const email = `seb@${typed}-${Date.now()}.example.test`;

      const { userId } = await startCodeSignup({ email, name: typed });

      expect(await hasProvisionalName(userId)).toBe(false);
    }
  });

  it("is stamped by a password signup, which has always had a name field", async () => {
    const email = `password-${Date.now()}@example.test`;

    const { user } = await registerUser({
      email,
      name: "Grace Hopper",
      password: "quiet-lantern-drifts-42",
    });

    expect(await hasProvisionalName(user.userId)).toBe(false);
  });
});

describe("a passkey ceremony started before the name screen", () => {
  it("holds no name at all, rather than a placeholder", async () => {
    const email = `passkey-${Date.now()}@example.test`;

    const options = await startPasskeySignup({ email, name: null });

    const [challenge] = await getDb()
      .select({ signupName: webauthnChallenges.signupName })
      .from(webauthnChallenges)
      .where(eq(webauthnChallenges.challenge, options.challenge));
    // The authenticator's prompt was shown the placeholder; the row keeps
    // null, so the account this becomes is one the dashboard asks about.
    expect(options.user.displayName).toBe(email.split("@")[0]);
    expect(challenge!.signupName).toBeNull();
  });
});

describe("reclaiming an unproved address", () => {
  it("hands back the placeholder rather than the last attempt's name", async () => {
    const email = `reclaimed-${Date.now()}@example.test`;
    await startCodeSignup({ email, name: "Somebody Else" });

    // Whoever is about to prove the inbox has not been asked yet, and must
    // not inherit a name they never chose — nor the stamp that goes with it.
    const { userId } = await startCodeSignup({ email, name: null });

    const row = await rowFor(email);
    expect(row.name).toBe(email.split("@")[0]);
    expect(row.nameChosenAt).toBeNull();
    expect(await hasProvisionalName(userId)).toBe(true);
  });
});

describe("an Apple sign-in", () => {
  it("leaves the account unnamed when Apple sends no name", async () => {
    // Apple offers the name on the first authorization and never again, so an
    // interrupted first attempt leaves nothing to fall back on but the local
    // part — and nobody has chosen it.
    const result = await signInWithApple({
      subject: `001234.${Date.now()}.0000`,
      email: `apple-nameless-${Date.now()}@example.test`,
      emailVerified: true,
      isPrivateEmail: false,
    });

    expect(await hasProvisionalName(result.user.userId)).toBe(true);
  });

  it("stamps the name Apple did send", async () => {
    const result = await signInWithApple(
      {
        subject: `001234.${Date.now() + 1}.0000`,
        email: `apple-named-${Date.now()}@example.test`,
        emailVerified: true,
        isPrivateEmail: false,
      },
      { fullName: "Ada Lovelace" },
    );

    expect(await hasProvisionalName(result.user.userId)).toBe(false);
  });
});
