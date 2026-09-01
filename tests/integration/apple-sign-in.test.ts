import { afterEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { oauthIdentities, passkeys, users } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  AuthError,
  getLinkedAppleIdentity,
  linkAppleIdentity,
  signInWithApple,
  unlinkAppleIdentity,
} from "@/modules/auth/service";
import { resolveSession } from "@/modules/auth/sessions";
import { hashPassword } from "@/modules/auth/passwords";
import { createTestUser } from "../helpers/factories";

/**
 * Which local account a verified Apple identity belongs to.
 *
 * The protocol half is unit-tested in src/modules/auth/apple.test.ts; by the
 * time anything here runs, the claims are already known to have come from
 * Apple. What is decided here is riskier and less obvious: whether an Apple
 * account may claim an existing local one. Getting that wrong is an account
 * takeover, so the refusals matter more than the happy path.
 */

function appleIdentity(
  overrides: Partial<Parameters<typeof signInWithApple>[0]> = {},
) {
  return {
    subject: `001234.${randomUUID()}.0000`,
    email: `apple-${randomUUID()}@example.test`,
    emailVerified: true,
    isPrivateEmail: false,
    ...overrides,
  };
}

afterEach(() => {
  delete process.env.ALLOW_REGISTRATION;
  resetEnvCache();
});

describe("signing in with Apple for the first time", () => {
  it("creates an account, links it, and starts a usable session", async () => {
    const identity = appleIdentity();

    const result = await signInWithApple(identity, {
      fullName: "Ada Lovelace",
    });

    expect(result.user.name).toBe("Ada Lovelace");
    expect(result.user.email).toBe(identity.email);
    // Apple verified the address; asking the person to verify it again by mail
    // would be putting a question to them that is already answered.
    expect(result.user.emailVerified).toBe(true);

    const session = await resolveSession(result.session.token);
    expect(session?.userId).toBe(result.user.userId);

    const linked = await getLinkedAppleIdentity(result.user.userId);
    expect(linked).toMatchObject({ email: identity.email });
  });

  it("falls back to the local part when Apple sends no name", async () => {
    // Apple offers the name on the first authorization and never again, so an
    // interrupted first attempt leaves nothing to fall back on but this.
    const identity = appleIdentity({ email: "grace.hopper@example.test" });

    const result = await signInWithApple(identity);

    expect(result.user.name).toBe("grace.hopper");
  });

  it("stores a relay address as one", async () => {
    const identity = appleIdentity({
      email: `${randomUUID()}@privaterelay.appleid.com`,
      isPrivateEmail: true,
    });

    const result = await signInWithApple(identity);

    expect(await getLinkedAppleIdentity(result.user.userId)).toMatchObject({
      isPrivateEmail: true,
    });
  });

  it("leaves the address unverified if Apple says it is", async () => {
    const result = await signInWithApple(
      appleIdentity({ emailVerified: false }),
    );
    expect(result.user.emailVerified).toBe(false);
  });

  it("refuses when Apple shares no address at all", async () => {
    await expect(
      signInWithApple(appleIdentity({ email: null })),
    ).rejects.toThrow(AuthError);
  });

  it("respects a closed instance", async () => {
    process.env.ALLOW_REGISTRATION = "false";
    resetEnvCache();

    await expect(signInWithApple(appleIdentity())).rejects.toThrow(
      /Registration is closed/,
    );
  });
});

describe("signing in again", () => {
  it("matches on the subject, not the address", async () => {
    const identity = appleIdentity();
    const first = await signInWithApple(identity);

    // Apple lets somebody switch off the relay, or change the address behind
    // it. The subject is the only thing that survives that, so it is the only
    // thing matched on.
    const changed = `changed-${randomUUID()}@example.test`;
    const second = await signInWithApple({ ...identity, email: changed });

    expect(second.user.userId).toBe(first.user.userId);
    const rows = await getDb()
      .select()
      .from(oauthIdentities)
      .where(eq(oauthIdentities.userId, first.user.userId));
    expect(rows).toHaveLength(1);
    // The address stored *against the Apple link* follows, so the security
    // page names the Apple ID that is actually linked. The account's own email
    // is a separate thing, and the test below holds it still.
    expect(rows[0].email).toBe(changed);
  });

  it("records when it was last used", async () => {
    const identity = appleIdentity();
    await signInWithApple(identity);
    const before = await signInWithApple(identity);

    const linked = await getLinkedAppleIdentity(before.user.userId);
    expect(linked?.lastUsedAt).toBeInstanceOf(Date);
  });

  it("refuses a disabled account", async () => {
    const identity = appleIdentity();
    const first = await signInWithApple(identity);

    await getDb()
      .update(users)
      .set({ disabledAt: new Date() })
      .where(eq(users.id, first.user.userId));

    await expect(signInWithApple(identity)).rejects.toThrow(AuthError);
  });

  it("does not change the account's own email", async () => {
    const identity = appleIdentity();
    const first = await signInWithApple(identity);

    await signInWithApple({
      ...identity,
      email: "somebody.else@example.test",
    });

    const [row] = await getDb()
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, first.user.userId));
    expect(row.email).toBe(first.user.email);
  });
});

describe("an address that already has an account", () => {
  it("refuses to claim an account this instance never verified", async () => {
    // The takeover this prevents: somebody registers with an address that is
    // not theirs — trivial on an instance with no SMTP, where nothing is ever
    // verified — and waits for its real owner to arrive through Apple.
    const existing = await createTestUser();
    await getDb()
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, existing.userId));

    await expect(
      signInWithApple(appleIdentity({ email: existing.email })),
    ).rejects.toThrow(/Sign in with your password or passkey/);

    expect(await getLinkedAppleIdentity(existing.userId)).toBeNull();
  });

  it("refuses when Apple itself has not verified the address", async () => {
    const existing = await createTestUser();

    await expect(
      signInWithApple(
        appleIdentity({ email: existing.email, emailVerified: false }),
      ),
    ).rejects.toThrow(AuthError);

    expect(await getLinkedAppleIdentity(existing.userId)).toBeNull();
  });

  it("links automatically only when both sides verified it", async () => {
    const existing = await createTestUser();

    const result = await signInWithApple(
      appleIdentity({ email: existing.email, emailVerified: true }),
    );

    expect(result.user.userId).toBe(existing.userId);
    expect(await getLinkedAppleIdentity(existing.userId)).not.toBeNull();
  });

  it("matches the address case-insensitively", async () => {
    const existing = await createTestUser();

    const result = await signInWithApple(
      appleIdentity({ email: existing.email.toUpperCase() }),
    );

    expect(result.user.userId).toBe(existing.userId);
  });
});

describe("linking from the security page", () => {
  it("links an Apple account to the signed-in user", async () => {
    const user = await createTestUser();
    const identity = appleIdentity();

    await linkAppleIdentity(user.userId, identity);

    expect(await getLinkedAppleIdentity(user.userId)).toMatchObject({
      email: identity.email,
    });
  });

  it("is the way through when the automatic path refused", async () => {
    // The full journey the refusal message describes: sign in the way you
    // already can, then link deliberately.
    const existing = await createTestUser();
    await getDb()
      .update(users)
      .set({ emailVerifiedAt: null })
      .where(eq(users.id, existing.userId));
    const identity = appleIdentity({ email: existing.email });

    await expect(signInWithApple(identity)).rejects.toThrow(AuthError);
    await linkAppleIdentity(existing.userId, identity);

    const result = await signInWithApple(identity);
    expect(result.user.userId).toBe(existing.userId);
  });

  it("refuses an Apple account that belongs to somebody else", async () => {
    const first = await createTestUser();
    const second = await createTestUser();
    const identity = appleIdentity();

    await linkAppleIdentity(first.userId, identity);

    await expect(linkAppleIdentity(second.userId, identity)).rejects.toThrow(
      /different Balancia account/,
    );
  });

  it("refuses a second Apple account on one user", async () => {
    const user = await createTestUser();
    await linkAppleIdentity(user.userId, appleIdentity());

    await expect(
      linkAppleIdentity(user.userId, appleIdentity()),
    ).rejects.toThrow(/Unlink it first/);
  });
});

describe("unlinking", () => {
  it("removes the link when a password remains", async () => {
    const user = await createTestUser();
    await getDb()
      .update(users)
      .set({ passwordHash: await hashPassword("quiet-lantern-drifts-42") })
      .where(eq(users.id, user.userId));
    await linkAppleIdentity(user.userId, appleIdentity());

    await unlinkAppleIdentity(user.userId);

    expect(await getLinkedAppleIdentity(user.userId)).toBeNull();
  });

  it("removes the link when a passkey remains", async () => {
    const user = await createTestUser();
    await linkAppleIdentity(user.userId, appleIdentity());
    await getDb().insert(passkeys).values({
      userId: user.userId,
      credentialId: randomUUID(),
      publicKey: "not-a-real-key",
    });

    await expect(unlinkAppleIdentity(user.userId)).resolves.toBeUndefined();
  });

  it("refuses to leave an account nobody can reach", async () => {
    // An account created through Apple has no password, and may have no
    // passkey. Unlinking would lock its owner out with no reset to recover by.
    const result = await signInWithApple(appleIdentity());

    await expect(unlinkAppleIdentity(result.user.userId)).rejects.toThrow(
      /only way you can sign in/,
    );

    expect(await getLinkedAppleIdentity(result.user.userId)).not.toBeNull();
  });

  it("says so when there is nothing to unlink", async () => {
    const user = await createTestUser();
    await getDb()
      .update(users)
      .set({ passwordHash: await hashPassword("quiet-lantern-drifts-42") })
      .where(eq(users.id, user.userId));

    await expect(unlinkAppleIdentity(user.userId)).rejects.toThrow(
      /no Apple account linked/,
    );
  });
});

describe("the identity row", () => {
  it("goes away with the account", async () => {
    const result = await signInWithApple(appleIdentity());
    const db = getDb();

    await db.delete(users).where(eq(users.id, result.user.userId));

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(oauthIdentities)
      .where(eq(oauthIdentities.userId, result.user.userId));
    expect(count).toBe(0);
  });
});
