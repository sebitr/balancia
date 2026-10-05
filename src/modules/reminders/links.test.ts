import { describe, expect, it } from "vitest";
import {
  permissionsForRole,
  type Actor,
  type GroupAccess,
} from "@/lib/security/authorization";
import type { JoinLinkView } from "@/lib/security/join-link";
import { attachableInviteUrl, maySendInviteLink, reminderLink } from "./links";
import { REMIND_BODY_MAX_LENGTH, REMIND_MESSAGE_MAX_LENGTH } from "./types";

/**
 * Which address a reminder that leaves the app ends with.
 *
 * Three questions, asked in this order by `listRemindRecipients`: may this
 * sender hand the invite link out at all, is there a live one to hand out, and
 * does the person being reminded need it. The last part of this file is the
 * whole chain at once, as the matrix the rule has to get right.
 */

const NOW = new Date("2026-10-05T12:00:00.000Z");
const INVITE_URL =
  "https://balancia.example/join/g/AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcde";

const user = (
  extra: Partial<Extract<Actor, { kind: "user" }>> = {},
): Actor => ({
  kind: "user",
  userId: "u1",
  email: "seb@example.com",
  name: "Seb",
  ...extra,
});

const guest: Actor = {
  kind: "guest",
  groupId: "g1",
  participantId: "p1",
  displayName: "Padi",
  sessionId: "s1",
};

function access(
  role: GroupAccess["role"],
  actor: Actor = role === "guest" ? guest : user(),
): Pick<GroupAccess, "permissions" | "actor"> {
  return { permissions: permissionsForRole(role), actor };
}

function link(overrides: Partial<JoinLinkView> = {}): JoinLinkView {
  return {
    status: "active",
    url: INVITE_URL,
    prefix: "AbCdEfGh",
    createdAt: new Date("2026-10-01T12:00:00.000Z"),
    expiresAt: new Date("2026-10-08T12:00:00.000Z"),
    lastUsedAt: null,
    ...overrides,
  };
}

describe("who may put the invite link in a reminder", () => {
  /** The owner is the one role that is shown the link anywhere. */
  it("lets the group's owner", () => {
    expect(maySendInviteLink(access("owner"))).toBe(true);
  });

  /** Members never see it on the People tab, so a reminder must not show it. */
  it("keeps it from a member", () => {
    expect(maySendInviteLink(access("member"))).toBe(false);
  });

  it("keeps it from a guest", () => {
    expect(maySendInviteLink(access("guest"))).toBe(false);
  });

  /**
   * The join-link route is a door no API key may reach, and the reminders
   * route is open to keys — so the list must not become the way round.
   */
  it("keeps it from an API key, even the owner's", () => {
    expect(
      maySendInviteLink(access("owner", user({ viaApiToken: true }))),
    ).toBe(false);
  });
});

describe("which invite link may still be sent", () => {
  it("sends a live one", () => {
    expect(
      attachableInviteUrl(link(), { now: NOW, groupArchived: false }),
    ).toBe(INVITE_URL);
  });

  it("sends one that never expires", () => {
    expect(
      attachableInviteUrl(link({ expiresAt: null }), {
        now: NOW,
        groupArchived: false,
      }),
    ).toBe(INVITE_URL);
  });

  it("never sends an expired one", () => {
    expect(
      attachableInviteUrl(link({ status: "expired" }), {
        now: NOW,
        groupArchived: false,
      }),
    ).toBeNull();
  });

  /** Read as active a moment ago, and past its date by the time it is asked. */
  it("never sends one that has lapsed since it was read", () => {
    expect(
      attachableInviteUrl(link({ expiresAt: NOW }), {
        now: NOW,
        groupArchived: false,
      }),
    ).toBeNull();
  });

  it("never sends a revoked one", () => {
    expect(
      attachableInviteUrl(link({ status: "revoked" }), {
        now: NOW,
        groupArchived: false,
      }),
    ).toBeNull();
  });

  /** `resolveJoinLink` turns every link of an archived group away. */
  it("never sends one for an archived group", () => {
    expect(
      attachableInviteUrl(link(), { now: NOW, groupArchived: true }),
    ).toBeNull();
  });

  /** Still works for whoever holds it, but cannot be shown again. */
  it("sends nothing when the stored copy cannot be opened", () => {
    expect(
      attachableInviteUrl(link({ url: null }), {
        now: NOW,
        groupArchived: false,
      }),
    ).toBeNull();
  });

  it("sends nothing when the group has never had one", () => {
    expect(
      attachableInviteUrl(null, { now: NOW, groupArchived: false }),
    ).toBeNull();
  });
});

describe("the address one reminder ends with", () => {
  it("gives somebody without an account the invite link", () => {
    expect(reminderLink(false, INVITE_URL)).toEqual({
      kind: "invite",
      url: INVITE_URL,
    });
  });

  /** Signing in is their way in, and it lands them on the group. */
  it("gives somebody with an account the group's page", () => {
    expect(reminderLink(true, INVITE_URL)).toEqual({ kind: "group" });
  });

  it("falls back to the group's page when there is no link to give", () => {
    expect(reminderLink(false, null)).toEqual({ kind: "group" });
  });
});

/**
 * The whole rule: account or not, a sender who may or may not see the link,
 * and a link that is live or has run out. Only one corner of the eight ends in
 * an invite link.
 */
describe("the rule, end to end", () => {
  const cases = [
    { account: false, visible: true, status: "active", invite: true },
    { account: false, visible: true, status: "expired", invite: false },
    { account: false, visible: false, status: "active", invite: false },
    { account: false, visible: false, status: "expired", invite: false },
    { account: true, visible: true, status: "active", invite: false },
    { account: true, visible: true, status: "expired", invite: false },
    { account: true, visible: false, status: "active", invite: false },
    { account: true, visible: false, status: "expired", invite: false },
  ] as const;

  it.each(cases)(
    "account $account, link visible $visible, link $status → invite $invite",
    ({ account, visible, status, invite }) => {
      const sender = access(visible ? "owner" : "member");
      const url = maySendInviteLink(sender)
        ? attachableInviteUrl(link({ status }), {
            now: NOW,
            groupArchived: false,
          })
        : null;

      expect(reminderLink(account, url)).toEqual(
        invite ? { kind: "invite", url: INVITE_URL } : { kind: "group" },
      );
    },
  );
});

/**
 * The textarea stops at `REMIND_BODY_MAX_LENGTH` so that the tail always fits
 * under the server's cap — a refusal discovered after the writing is the thing
 * the split exists to prevent. The invite link is the longer of the two links,
 * so it is the one to measure.
 */
describe("the room the link needs", () => {
  it("still fits a full draft, a long payment line and an invite link", () => {
    // A self-hosted origin longer than most, a 43-character token, and a
    // payment line as long as a Pix copy-and-paste code runs with its label.
    const origin = "https://balancia.a-rather-long-self-hosted-domain.example";
    const invite = `${origin}/join/g/${"x".repeat(43)}`;
    const payLine = "x".repeat(250);

    const message = ["x".repeat(REMIND_BODY_MAX_LENGTH), payLine, invite].join(
      "\n",
    );

    expect(message.length).toBeLessThanOrEqual(REMIND_MESSAGE_MAX_LENGTH);
  });
});
