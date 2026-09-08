import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { groupMembers, participants } from "@/lib/db/schema";
import { createJoinLink } from "@/lib/security/join-link";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import {
  redeemInvitation,
  resolveGuestSession,
} from "@/lib/security/guest-session";
import { createInvitation } from "@/modules/groups/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
} from "../helpers/factories";

/**
 * Who may touch the group's front door, over the mobile API.
 *
 * The web has always read this link behind `manageInvitations`, which is the
 * owner's alone — all three of its pages fetch it only when that flag is set,
 * so a member has never been shown one. The mobile route checked that the
 * caller was in the group and nothing more, which meant a guest — somebody
 * holding an invitation that was forwarded to them — could mint a standing way
 * into the group, and revoke the owner's.
 *
 * These are the route handlers rather than the services, because the services
 * take a group id and enforce nothing: the guard is the route's, as it is the
 * page's on the web, and a test against the service would pass while the door
 * stood open.
 */

const currentActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    currentActor.value?.kind === "user" ? currentActor.value : null,
  getCurrentActor: async () => currentActor.value,
  getClientIp: async () => "127.0.0.1",
}));

const { GET, POST, DELETE } =
  await import("@/app/api/groups/[groupId]/join-link/route");

beforeEach(() => {
  currentActor.value = null;
});

function context(groupId: string) {
  return { params: Promise.resolve({ groupId }) } as never;
}

function request(method: string, body?: unknown): Request {
  return new Request("http://localhost/api/groups/x/join-link", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/** A user who joined a group somebody else owns. */
async function addMember(groupId: string): Promise<UserActor> {
  const db = getDb();
  const actor = await createTestUser({ name: "Grace" });
  const [participant] = await db
    .insert(participants)
    .values({
      groupId,
      displayName: "Grace",
      email: actor.email,
      userId: actor.userId,
    })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId,
    userId: actor.userId,
    participantId: participant!.id,
    role: "member",
  });
  return actor;
}

/** Somebody holding a one-time invitation to one seat. */
async function addGuest(
  group: Awaited<ReturnType<typeof createTestGroup>>,
): Promise<GuestActor> {
  const seat = await addTestParticipant(group.groupId, "Hervé");
  const invitation = await createInvitation(group.access, {
    participantId: seat,
  });
  const redeemed = await redeemInvitation(invitation.token);
  const session = await resolveGuestSession(redeemed.token);
  if (!session) throw new Error("Expected a live guest session");
  return {
    kind: "guest",
    groupId: session.groupId,
    participantId: session.participantId,
    displayName: session.displayName,
    sessionId: session.sessionId,
  };
}

describe("the group-wide join link over the mobile API", () => {
  it("hands the owner the link itself, not only its prefix", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const minted = await createJoinLink(group.groupId);
    currentActor.value = owner;

    const response = await GET(request("GET"), context(group.groupId));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.link.status).toBe("active");
    // The whole point: the phone can hand this over, where before it could
    // only name a link it did not hold.
    expect(body.link.url).toContain(minted.token);
    expect(body.link.prefix).toBe(minted.prefix);
  });

  it("answers a member the way it answers a stranger", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await createJoinLink(group.groupId);
    currentActor.value = await addMember(group.groupId);

    const response = await GET(request("GET"), context(group.groupId));

    expect(response.status).toBe(404);
    expect(await response.text()).not.toContain("join/g/");
  });

  it("refuses a guest the link, and refuses them one of their own", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const existing = await createJoinLink(group.groupId);
    currentActor.value = await addGuest(group);

    const read = await GET(request("GET"), context(group.groupId));
    expect(read.status).toBe(404);

    // The sharper half. A guest is somebody who arrived through a link that
    // was forwarded to them; minting is how they would turn that into a
    // standing way in, for themselves and anybody they passed it to.
    const minted = await POST(
      request("POST", { expiresInDays: 30 }),
      context(group.groupId),
    );
    expect(minted.status).toBe(404);
    expect(await minted.text()).not.toContain("join/g/");

    const revoked = await DELETE(request("DELETE"), context(group.groupId));
    expect(revoked.status).toBe(404);

    // And the owner's link is untouched by any of it.
    currentActor.value = owner;
    const after = await GET(request("GET"), context(group.groupId));
    const body = await after.json();
    expect(body.link.prefix).toBe(existing.prefix);
    expect(body.link.status).toBe("active");
  });

  it("says there is no link rather than inventing one", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    currentActor.value = owner;

    const response = await GET(request("GET"), context(group.groupId));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ link: null });
  });

  it("is not fooled by a group id that is not a group", async () => {
    currentActor.value = await createTestUser();

    const response = await GET(request("GET"), context(randomUUID()));

    expect(response.status).toBe(404);
  });
});
