import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { guestInvitations, participants, users } from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import {
  GUEST_COOKIE_NAME,
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { REGISTRATION_COOKIE_NAME } from "@/modules/auth/registration-browser";
import { registerUser, verifyEmail } from "@/modules/auth/service";
import { SESSION_COOKIE_NAME } from "@/modules/auth/sessions";
import { createInvitation } from "@/modules/groups/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * The confirmation link, and what spending it is worth.
 *
 * The link proved control of the inbox — the same proof a password reset
 * turns into a session and the six-digit code turns into one on the spot. It
 * used to land on an empty sign-in form, asking for the proof a second time.
 * The route now signs the person in, so what it needs from the service is
 * whose address was just proved.
 *
 * It signs them in only in the browser that registered, and the second half of
 * this file is why: a link is a URL, and a URL opened in somebody else's
 * browser used to sign that browser into the sender's account — taking the
 * guest seat its cookie held along with it.
 */

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);

vi.mock("@/modules/auth/mailer", () => ({
  sendMail: vi.fn(async (message: (typeof sent)[number]) => {
    sent.push(message);
  }),
}));

/**
 * One browser's cookie jar, standing in for `next/headers`. The route, the
 * action and the cookie helpers all run for real against it; only the request
 * scope Next would have given them is simulated.
 */
const browser = vi.hoisted(() => {
  const jar = new Map<string, string>();
  return {
    jar,
    store: {
      get: (name: string) =>
        jar.has(name) ? { name, value: jar.get(name)! } : undefined,
      set: (name: string, value: string, options?: { maxAge?: number }) => {
        if (value === "" || options?.maxAge === 0) jar.delete(name);
        else jar.set(name, value);
      },
      delete: (name: string) => {
        jar.delete(name);
      },
    },
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => browser.store,
  headers: async () =>
    new Headers({ "user-agent": "vitest", "accept-language": "en" }),
}));

const { GET: openLink } = await import("@/app/verify-email/route");
const { registerAction } = await import("@/modules/auth/actions");

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
  browser.jar.clear();
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

/** A group with a guest whose cookie this browser holds, as after their link. */
async function guestInThisBrowser() {
  const owner = await createTestUser();
  const group = await createTestGroup(owner);
  const seat = await addTestParticipant(group.groupId, "Grace");
  const invitation = await createInvitation(group.access, {
    participantId: seat,
  });
  const redeemed = await redeemInvitation(invitation.token);
  browser.jar.set(GUEST_COOKIE_NAME, redeemed.token);
  return {
    groupId: group.groupId,
    seat,
    invitationId: invitation.invitationId,
    guestToken: redeemed.token,
  };
}

async function openInThisBrowser(token: string) {
  const response = await openLink(
    new Request(`http://localhost:3000/verify-email?token=${token}`),
  );
  const location = new URL(response.headers.get("location") ?? "/", "http://x");
  return {
    status: response.status,
    location: `${location.pathname}${location.search}`,
  };
}

async function seatOf(participantId: string) {
  const [seat] = await getDb()
    .select({ userId: participants.userId })
    .from(participants)
    .where(eq(participants.id, participantId));
  const [invitation] = await getDb()
    .select({ revokedAt: guestInvitations.revokedAt })
    .from(guestInvitations)
    .where(eq(guestInvitations.participantId, participantId));
  return { userId: seat!.userId, linkRevokedAt: invitation!.revokedAt };
}

describe("opening the link", () => {
  it("signs in the browser that registered, and brings its guest seat along", async () => {
    const guest = await guestInThisBrowser();
    const email = `grace-${Date.now()}@example.test`;

    const registered = await registerAction({
      name: "Grace",
      email,
      password: "orchid-lantern-42",
    });
    expect(registered).toMatchObject({
      ok: true,
      data: { verificationRequired: true },
    });
    expect(browser.jar.has(REGISTRATION_COOKIE_NAME)).toBe(true);
    expect(browser.jar.has(SESSION_COOKIE_NAME)).toBe(false);

    const opened = await openInThisBrowser(linkToken(sent[0]!.text));

    expect(opened).toEqual({
      status: 303,
      location: `/register/done?group=${guest.groupId}`,
    });
    expect(browser.jar.has(SESSION_COOKIE_NAME)).toBe(true);
    // Spent with the link: it vouched for one confirmation, not for ever.
    expect(browser.jar.has(REGISTRATION_COOKIE_NAME)).toBe(false);
    expect(browser.jar.has(GUEST_COOKIE_NAME)).toBe(false);

    const [account] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email));
    const seat = await seatOf(guest.seat);
    expect(seat.userId).toBe(account!.id);
    expect(seat.linkRevokedAt).not.toBeNull();
  });

  it("confirms the address from another browser without signing it in", async () => {
    // Somebody registers their own address and forwards the link, unopened,
    // to a guest. Before this, one click signed the guest's browser into the
    // sender's account and moved the guest's seat across to it.
    const sender = `sender-${Date.now()}@example.test`;
    const registered = await registerAction({
      name: "Mallory",
      email: sender,
      password: "orchid-lantern-42",
    });
    expect(registered.ok).toBe(true);
    const token = linkToken(sent[0]!.text);

    browser.jar.clear();
    const guest = await guestInThisBrowser();

    const opened = await openInThisBrowser(token);

    expect(opened).toEqual({ status: 303, location: "/sign-in?verified=1" });
    expect(browser.jar.has(SESSION_COOKIE_NAME)).toBe(false);

    // The guest is exactly where they were: unlinked seat, live link, live
    // session, cookie still in the browser.
    expect(await seatOf(guest.seat)).toEqual({
      userId: null,
      linkRevokedAt: null,
    });
    await expect(resolveGuestSession(guest.guestToken)).resolves.toMatchObject({
      participantId: guest.seat,
    });
    expect(browser.jar.get(GUEST_COOKIE_NAME)).toBe(guest.guestToken);

    // And the address is confirmed all the same: the owner of the inbox may
    // well have read it on another device, and signs in with their password.
    const [row] = await getDb()
      .select({ verifiedAt: users.emailVerifiedAt })
      .from(users)
      .where(eq(users.email, sender));
    expect(row!.verifiedAt).not.toBeNull();
  });

  it("does not take one account's registration for another's", async () => {
    // This browser did register — somebody else. The cookie names that
    // account, and a link for a different one opens nothing here.
    await registerAction({
      name: "Grace",
      email: `grace-${Date.now()}@example.test`,
      password: "orchid-lantern-42",
    });
    await registerUser({
      email: `sender-${Date.now()}@example.test`,
      name: "Mallory",
      password: "orchid-lantern-42",
    });
    const guest = await guestInThisBrowser();

    const opened = await openInThisBrowser(linkToken(sent[1]!.text));

    expect(opened.location).toBe("/sign-in?verified=1");
    expect(browser.jar.has(SESSION_COOKIE_NAME)).toBe(false);
    expect((await seatOf(guest.seat)).userId).toBeNull();
    // Still there for the link it does vouch for.
    expect(browser.jar.has(REGISTRATION_COOKIE_NAME)).toBe(true);
  });
});
