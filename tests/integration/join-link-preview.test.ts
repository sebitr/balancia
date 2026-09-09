import { eq } from "drizzle-orm";
import { IntlMessageFormat } from "intl-messageformat";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { activityEvents, groups, guestSessions } from "@/lib/db/schema";
import { createJoinLink, resolveJoinLink } from "@/lib/security/join-link";
import { createInvitation } from "@/modules/groups/service";
import en from "../../messages/en.json";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * What a chat app is told when a join link is pasted into it.
 *
 * These are the route handlers rather than the helpers underneath, because
 * the property worth protecting is the routes': a crawler must come away with
 * the group's name and nothing spent. Both of them used to spend something —
 * the group link stamped itself as used, and the personal one minted a guest
 * session and announced an arrival in the group's history — so "no rows were
 * written" is asserted here and not inferred.
 *
 * The other half is the regression guard. A person must still be redirected
 * into the flow, and the tests that say so are the ones that would fail if
 * the recognition ever grew too eager.
 */

const WHATSAPP = "WhatsApp/2.23.20.0 A";
const SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

vi.mock("@/lib/security/actor", () => ({
  getClientIp: async () => "203.0.113.10",
  getCurrentUser: async () => null,
  getCurrentActor: async () => null,
}));

const cookies = vi.hoisted(() => ({
  setJoinCookie: vi.fn(async () => undefined),
  setGuestCookie: vi.fn(async () => undefined),
}));

vi.mock("@/modules/auth/cookies", () => cookies);

/**
 * The real catalogue, formatted the way `next-intl` would. Mocking `t()` to
 * echo its key would leave the placeholders untested, and a bubble reading
 * "Join {group} on Balancia" is the failure this file exists to catch.
 */
vi.mock("next-intl/server", () => ({
  getLocale: async () => "en",
  getTranslations: async (namespace: string) => {
    const messages = (en as unknown as Record<string, Record<string, string>>)[
      namespace
    ];
    return (key: string, values?: Record<string, unknown>) =>
      new IntlMessageFormat(messages[key], "en").format(values) as string;
  },
}));

const { GET: openGroupLink } = await import("@/app/join/g/[token]/route");
const { GET: openInvitation } = await import("@/app/join/[token]/route");

function request(url: string, userAgent: string): Request {
  return new Request(url, { headers: { "user-agent": userAgent } });
}

function context(token: string) {
  return { params: Promise.resolve({ token }) } as never;
}

/** A group with a decoration, so the card in the bubble has one to show. */
async function decoratedGroup(name: string) {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, { name });
  await getDb()
    .update(groups)
    .set({ icon: "plane", iconColor: "blue" })
    .where(eq(groups.id, group.groupId));
  return { owner, group };
}

beforeEach(() => {
  cookies.setJoinCookie.mockClear();
  cookies.setGuestCookie.mockClear();
});

describe("the group-wide join link, fetched by a chat app", () => {
  it("answers with the group's name, its card, and no session", async () => {
    const { owner, group } = await decoratedGroup("Lisbon trip");
    const link = await createJoinLink(group.groupId, {
      createdByUserId: owner.userId,
    });

    const response = await openGroupLink(
      request(`http://localhost/join/g/${link.token}`, WHATSAPP),
      context(link.token),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(html).toContain(
      '<meta property="og:title" content="Join Lisbon trip on Balancia" />',
    );
    expect(html).toContain(
      '<meta property="og:description" content="Ada invites you to join Lisbon trip and keep track of who owes what." />',
    );
    expect(html).toContain("/join/og/blue/plane");
    expect(cookies.setJoinCookie).not.toHaveBeenCalled();
  });

  it("does not report the link as opened", async () => {
    // The organiser's card says when the link was last used. A crawler
    // drawing a bubble has not used it, and saying otherwise would have them
    // believe five people arrived the moment they pasted it.
    const { group } = await decoratedGroup("Flat");
    const link = await createJoinLink(group.groupId);

    await openGroupLink(
      request(`http://localhost/join/g/${link.token}`, WHATSAPP),
      context(link.token),
    );

    const rows = await getDb().query.groupJoinLinks.findMany({
      where: (table, { eq: is }) => is(table.id, link.linkId),
    });
    expect(rows[0]?.lastUsedAt).toBeNull();
  });

  it("says nothing about a link that no longer works", async () => {
    const { group } = await decoratedGroup("Secret supper club");
    const link = await createJoinLink(group.groupId);
    // Superseded, which is what revoking looks like from the outside.
    await createJoinLink(group.groupId);

    const response = await openGroupLink(
      request(`http://localhost/join/g/${link.token}`, WHATSAPP),
      context(link.token),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain("Secret supper club");
    expect(html).toContain('<meta property="og:title" content="Balancia" />');
  });

  it("says nothing about a token nobody ever minted", async () => {
    const token = "A".repeat(43);
    const response = await openGroupLink(
      request(`http://localhost/join/g/${token}`, WHATSAPP),
      context(token),
    );

    expect(response.status).toBe(200);
    await expect(response.text()).resolves.toContain(
      '<meta property="og:title" content="Balancia" />',
    );
  });

  it("still sends a person into the flow", async () => {
    const { group } = await decoratedGroup("Lisbon trip");
    const link = await createJoinLink(group.groupId);

    const response = await openGroupLink(
      request(`http://localhost/join/g/${link.token}`, SAFARI),
      context(link.token),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/join/start");
    expect(cookies.setJoinCookie).toHaveBeenCalledWith(link.token);
  });
});

describe("a personal invitation link, fetched by a chat app", () => {
  async function invitation(groupName: string) {
    const { group } = await decoratedGroup(groupName);
    const participantId = await addTestParticipant(group.groupId, "Jonas");
    const created = await createInvitation(group.access, { participantId });
    return { group, participantId, created };
  }

  it("answers with the group's name and its card", async () => {
    const { created } = await invitation("Lisbon trip");

    const response = await openInvitation(
      request(`http://localhost/join/${created.token}`, WHATSAPP),
      context(created.token),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).toContain(
      '<meta property="og:title" content="Lisbon trip on Balancia" />',
    );
    expect(html).toContain("/join/og/blue/plane");
  });

  it("mints no guest session and announces no arrival", async () => {
    // Redeeming writes both, and following the redirect is exactly what a
    // crawler does — so before this, pasting the link anywhere put a stranger
    // in the group's history.
    const { created } = await invitation("Flat");

    await openInvitation(
      request(`http://localhost/join/${created.token}`, WHATSAPP),
      context(created.token),
    );

    const db = getDb();
    await expect(db.select().from(guestSessions)).resolves.toEqual([]);
    // Minting the link is its own event and belongs in the history; being
    // fetched by a crawler is not, and must not join it.
    const history = await db
      .select({ action: activityEvents.action })
      .from(activityEvents);
    expect(history.map((event) => event.action)).toEqual([
      "guest_link.created",
    ]);
    expect(cookies.setGuestCookie).not.toHaveBeenCalled();
  });

  it("says nothing about an invitation that was revoked", async () => {
    const { group, participantId, created } =
      await invitation("Secret supper club");
    // Regenerating for the same participant revokes the one before it, which
    // is the recovery path for a link that reached the wrong chat.
    await createInvitation(group.access, { participantId });

    const response = await openInvitation(
      request(`http://localhost/join/${created.token}`, WHATSAPP),
      context(created.token),
    );
    const html = await response.text();

    expect(response.status).toBe(200);
    expect(html).not.toContain("Secret supper club");
    expect(html).toContain('<meta property="og:title" content="Balancia" />');
  });

  it("still redeems for a person", async () => {
    const { created } = await invitation("Lisbon trip");

    const response = await openInvitation(
      request(`http://localhost/join/${created.token}`, SAFARI),
      context(created.token),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("/invite");
    expect(cookies.setGuestCookie).toHaveBeenCalled();
    await expect(getDb().select().from(guestSessions)).resolves.toHaveLength(1);
  });
});

describe("what the link resolver hands the card", () => {
  it("carries the group's decoration, narrowed to what can be drawn", async () => {
    const { group } = await decoratedGroup("Lisbon trip");
    const link = await createJoinLink(group.groupId);

    await expect(resolveJoinLink(link.token)).resolves.toMatchObject({
      groupName: "Lisbon trip",
      groupIcon: "plane",
      groupIconColor: "blue",
    });
  });

  it("drops an icon this build no longer draws", async () => {
    // The column checks the shape of a slug and not its membership, so a row
    // written by an older build can name an icon that has since been removed.
    const owner = await createTestUser({ name: "Ada" });
    const group = await createTestGroup(owner, { name: "Old group" });
    await getDb()
      .update(groups)
      .set({ icon: "zeppelin", iconColor: "chartreuse" })
      .where(eq(groups.id, group.groupId));
    const link = await createJoinLink(group.groupId);

    await expect(resolveJoinLink(link.token)).resolves.toMatchObject({
      groupIcon: null,
      groupIconColor: null,
    });
  });
});
