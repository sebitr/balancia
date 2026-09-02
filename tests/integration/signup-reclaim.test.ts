import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { AuthError, registerUser } from "@/modules/auth/service";
import { createSession } from "@/modules/auth/sessions";
import { startCodeSignup } from "@/modules/auth/signup";

/**
 * A second signup at an address that was begun and never proved.
 *
 * Both paths that mail the address write the user row first, so "Send another
 * code" and "try again tomorrow" used to be answered with `emailTaken` — the
 * wrong sentence for the person who typed the address twice, and a door with
 * no way through for the one who closed the tab. The row is reclaimed instead,
 * on the same terms the sweep uses to decide nothing ever got into it.
 */

const sent: { to: string }[] = [];

vi.mock("@/modules/auth/mailer", () => ({
  sendMail: vi.fn(async (message: { to: string }) => {
    sent.push({ to: message.to });
  }),
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

beforeEach(() => {
  sent.length = 0;
  withSmtp(true);
});

afterEach(() => {
  withSmtp(false);
});

async function rowsFor(email: string) {
  return getDb()
    .select({
      id: users.id,
      name: users.name,
      passwordHash: users.passwordHash,
      emailVerifiedAt: users.emailVerifiedAt,
    })
    .from(users)
    .where(eq(sql`lower(${users.email})`, email.toLowerCase()));
}

describe("a second code signup at an unproved address", () => {
  it("mails a fresh code to the same row instead of refusing", async () => {
    const email = `resend-${Date.now()}@example.test`;

    const first = await startCodeSignup({ email, name: "First try" });
    const second = await startCodeSignup({ email, name: "Second try" });

    expect(second.userId).toBe(first.userId);
    expect(sent.map((m) => m.to)).toEqual([email, email]);
    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    // The latest attempt's name wins: it is the one about to prove the inbox.
    expect(rows[0]!.name).toBe("Second try");
  });

  it("drops a password an earlier, unproved attempt chose", async () => {
    const email = `squatted-${Date.now()}@example.test`;
    await registerUser({
      email,
      name: "Squatter",
      password: "orchid-lantern-42",
    });
    expect((await rowsFor(email))[0]!.passwordHash).not.toBeNull();

    await startCodeSignup({ email, name: "Owner" });

    const [row] = await rowsFor(email);
    expect(row!.passwordHash).toBeNull();
    expect(row!.name).toBe("Owner");
  });

  it("lets a password signup reclaim the row too", async () => {
    const email = `again-${Date.now()}@example.test`;
    await startCodeSignup({ email, name: "By code" });

    const result = await registerUser({
      email,
      name: "By password",
      password: "orchid-lantern-42",
    });

    const rows = await rowsFor(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(result.user.userId);
    expect(rows[0]!.name).toBe("By password");
    expect(rows[0]!.passwordHash).not.toBeNull();
  });

  it("still refuses an address that somebody got into", async () => {
    const email = `taken-${Date.now()}@example.test`;
    const { userId } = await startCodeSignup({ email, name: "Owner" });
    // A session is what getting in looks like; the address is spoken for.
    await createSession(userId, {});

    await expect(
      startCodeSignup({ email, name: "Somebody else" }),
    ).rejects.toMatchObject({ code: "emailTaken" });
    expect((await rowsFor(email))[0]!.name).toBe("Owner");
  });

  it("still refuses a verified address, whatever else is true of it", async () => {
    const email = `verified-${Date.now()}@example.test`;
    const { userId } = await startCodeSignup({ email, name: "Owner" });
    await getDb()
      .update(users)
      .set({ emailVerifiedAt: new Date() })
      .where(eq(users.id, userId));

    await expect(
      startCodeSignup({ email, name: "Somebody else" }),
    ).rejects.toBeInstanceOf(AuthError);
  });
});
