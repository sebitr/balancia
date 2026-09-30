import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, groupMembers, groups, participants } from "@/lib/db/schema";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import { classifyStatus } from "@/lib/offline/replay";
import { createApiToken } from "@/modules/api-tokens/service";
import { createExpense } from "@/modules/expenses/service";
import { expenseInputSchema } from "@/modules/expenses/schemas";
import { removeParticipant, setGroupArchived } from "@/modules/groups/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * What the mobile API answers somebody refused inside their own group.
 *
 * It used to answer every refusal "Not found.", which is right for somebody
 * outside the group and was wrong for everybody in it. The owner trying to
 * remove themselves was told their own group did not exist. An entry naming
 * somebody removed a minute before was told the same, and the web's offline
 * queue — reading a 404 the way any client would — told its author they had
 * lost the group.
 *
 * Driven through the route handlers, because the status is the route's
 * answer: the services only throw. The expense and group routes are reached
 * with a key, which is how a Shortcut or a script reaches them. The people
 * routes are refused to every key, so they are reached with the session a
 * phone signs in with instead.
 */

const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () =>
    cookieActor.value?.kind === "user" ? cookieActor.value : null,
  getCurrentActor: async () => cookieActor.value,
  getClientIp: async () => "127.0.0.1",
}));

const expensesRoute = await import("@/app/api/groups/[groupId]/expenses/route");
const expenseRoute =
  await import("@/app/api/groups/[groupId]/expenses/[expenseId]/route");
const groupRoute = await import("@/app/api/groups/[groupId]/route");
const participantRoute =
  await import("@/app/api/groups/[groupId]/participants/[participantId]/route");
const invitationRoute =
  await import("@/app/api/groups/[groupId]/participants/[participantId]/invitation/route");

beforeEach(() => {
  cookieActor.value = null;
});

function context(params: Record<string, string>) {
  return { params: Promise.resolve(params) } as never;
}

function request(
  method: string,
  options: { key?: string; body?: unknown } = {},
): Request {
  return new Request("http://localhost/api/groups/x", {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(options.key ? { Authorization: `Bearer ${options.key}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

async function writeKey(user: UserActor): Promise<string> {
  const { token } = await createApiToken(user.userId, {
    name: "Shortcut",
    scope: "write",
  });
  return token;
}

/** Paid by `payer`, split equally with `others`. */
function dinner(payer: string, others: readonly string[] = []) {
  return {
    description: "Dinner",
    amount: "3000",
    currency: "EUR",
    expenseDate: isoToday(),
    payers: [{ participantId: payer, amount: "3000" }],
    splitMethod: "equal",
    splitEntries: [payer, ...others].map((participantId) => ({
      participantId,
    })),
  };
}

/** A user who joined a group somebody else owns. */
async function addMember(groupId: string): Promise<UserActor> {
  const db = getDb();
  const member = await createTestUser({ name: "Grace" });
  const [participant] = await db
    .insert(participants)
    .values({
      groupId,
      displayName: "Grace",
      email: member.email,
      userId: member.userId,
    })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId,
    userId: member.userId,
    participantId: participant!.id,
    role: "member",
  });
  return member;
}

/** The group's expenses that are not deleted. */
async function expensesIn(groupId: string): Promise<number> {
  const rows = await getDb()
    .select({ id: expenses.id })
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));
  return rows.length;
}

describe("an entry naming somebody who has been removed", () => {
  it("is a 422 that says so, and the offline queue reads it as a refusal", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const bob = await addTestParticipant(group.groupId, "Bob");
    await removeParticipant(group.access, bob);

    const response = await expensesRoute.POST(
      request("POST", {
        key: await writeKey(owner),
        body: dinner(group.ownerParticipantId, [bob]),
      }),
      context({ groupId: group.groupId }),
    );
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body).toEqual({
      error: "One or more of those people are not part of this group.",
      code: "participantNotInGroup",
    });
    expect(await expensesIn(group.groupId)).toBe(0);
    // What the web's queue does with that answer: holds the entry back with
    // "Somebody on it may have been removed from the group", rather than
    // telling its author the group is no longer theirs.
    expect(classifyStatus(response.status, body.code)).toEqual({
      kind: "blocked",
      reason: "refused",
    });
  });
});

describe("a change to an archived group", () => {
  it("is a 409 that says the group is archived", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    await setGroupArchived(group.access, true);

    const response = await expensesRoute.POST(
      request("POST", {
        key: await writeKey(owner),
        body: dinner(group.ownerParticipantId),
      }),
      context({ groupId: group.groupId }),
    );
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body).toEqual({
      error: "This group is archived. Restore it before making changes.",
      code: "groupArchived",
    });
    expect(await expensesIn(group.groupId)).toBe(0);
    // Held back as archived — a group its reader can still open — and not
    // retried, which would stall every entry queued behind it.
    expect(classifyStatus(response.status, body.code)).toEqual({
      kind: "blocked",
      reason: "archived",
    });
  });
});

describe("an owner-only change asked for by a member", () => {
  it("is a 403 that says whose it is, and changes nothing", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner, { name: "Lisbon" });
    const member = await addMember(group.groupId);

    const response = await groupRoute.PATCH(
      request("PATCH", {
        key: await writeKey(member),
        body: { name: "Porto", timezone: "UTC" },
      }),
      context({ groupId: group.groupId }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "You cannot do that in this group. Ask its owner.",
      code: "noPermission",
    });
    const [row] = await getDb()
      .select({ name: groups.name })
      .from(groups)
      .where(eq(groups.id, group.groupId));
    expect(row!.name).toBe("Lisbon");
  });

  it("is the same 403 for removing somebody", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const bob = await addTestParticipant(group.groupId, "Bob");
    cookieActor.value = await addMember(group.groupId);

    const response = await participantRoute.DELETE(
      request("DELETE"),
      context({ groupId: group.groupId, participantId: bob }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "noPermission" });
  });
});

describe("the people screen", () => {
  it("tells the owner they cannot be removed, with a 409", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    cookieActor.value = owner;

    const response = await participantRoute.DELETE(
      request("DELETE"),
      context({
        groupId: group.groupId,
        participantId: group.ownerParticipantId,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "The group owner cannot be removed from the group. Archive it or delete it instead.",
      code: "ownerNotRemovable",
    });
    const [row] = await getDb()
      .select({ removedAt: participants.removedAt })
      .from(participants)
      .where(eq(participants.id, group.ownerParticipantId));
    expect(row!.removedAt).toBeNull();
  });

  it("makes no guest link for somebody who signs in, with a 409", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    cookieActor.value = owner;

    const response = await invitationRoute.POST(
      request("POST", { body: {} }),
      context({
        groupId: group.groupId,
        participantId: group.ownerParticipantId,
      }),
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      code: "participantHasAccount",
    });
  });

  it("leaves somebody's own name to them, with a 403", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    cookieActor.value = await addMember(group.groupId);

    const response = await participantRoute.PATCH(
      request("PATCH", { body: { displayName: "Not Ada" } }),
      context({
        groupId: group.groupId,
        participantId: group.ownerParticipantId,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "notYourAccount" });
  });
});

describe("a refusal to somebody outside the group", () => {
  it("is still a 404 that says nothing", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const outsider = await createTestUser();

    const response = await expensesRoute.POST(
      request("POST", {
        key: await writeKey(outsider),
        body: dinner(group.ownerParticipantId),
      }),
      context({ groupId: group.groupId }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("is still a 404 for an entry that belongs to another group", async () => {
    // The same owner, so both groups are theirs: what is refused is only that
    // this expense is not in the group the path names, and that must read
    // exactly like an id nobody minted.
    const owner = await createTestUser();
    const group = await createTestGroup(owner, { name: "Mine" });
    const other = await createTestGroup(owner, { name: "Theirs" });
    const elsewhere = await createExpense(
      other.access,
      expenseInputSchema.parse(dinner(other.ownerParticipantId)),
    );

    const response = await expenseRoute.DELETE(
      request("DELETE", { key: await writeKey(owner) }),
      context({ groupId: group.groupId, expenseId: elsewhere }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
    expect(await expensesIn(other.groupId)).toBe(1);
  });
});
