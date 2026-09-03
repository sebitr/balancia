import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { users } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { registerUser, verifyEmail } from "@/modules/auth/service";

/**
 * The confirmation link, and what spending it is worth.
 *
 * The link proved control of the inbox — the same proof a password reset
 * turns into a session and the six-digit code turns into one on the spot. It
 * used to land on an empty sign-in form, asking for the proof a second time.
 * The route now signs the person in, so what it needs from the service is
 * whose address was just proved.
 */

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);

vi.mock("@/modules/auth/mailer", () => ({
  sendMail: vi.fn(async (message: (typeof sent)[number]) => {
    sent.push(message);
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

function linkToken(body: string): string {
  const match = /[?&]token=([A-Za-z0-9_-]+)/.exec(body);
  if (!match) throw new Error("No token in the mail");
  return match[1]!;
}

describe("verifyEmail", () => {
  it("says whose address was proved, and marks it so", async () => {
    const email = `confirm-${Date.now()}@example.test`;
    const registered = await registerUser({
      email,
      name: "Grace",
      password: "orchid-lantern-42",
    });
    expect(registered.verificationRequired).toBe(true);
    const token = linkToken(sent[0]!.text);

    const verified = await verifyEmail(token);

    expect(verified).toEqual({ userId: registered.user.userId });
    const [row] = await getDb()
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.id, registered.user.userId));
    expect(row!.verifiedAt).not.toBeNull();
  });

  it("spends the link once", async () => {
    const email = `once-${Date.now()}@example.test`;
    await registerUser({ email, name: "Grace", password: "orchid-lantern-42" });
    const token = linkToken(sent[0]!.text);

    expect(await verifyEmail(token)).not.toBeNull();
    expect(await verifyEmail(token)).toBeNull();
  });

  it("answers nothing for a token nobody issued", async () => {
    expect(await verifyEmail("not-a-token")).toBeNull();
  });
});
