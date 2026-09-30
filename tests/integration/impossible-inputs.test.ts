import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { expenses } from "@/lib/db/schema";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import { createTestGroup, createTestUser } from "../helpers/factories";

/**
 * Inputs that used to pass validation and then fail in PostgreSQL.
 *
 * Through the route handlers and a real database, because the database is the
 * half that refused: `Date.parse` rolled `2025-02-30` over into March and said
 * yes, the `date` column said no, and the answer was a 500 — which the offline
 * outbox reads as "try again", for ever. Each of these must now be a 4xx the
 * caller can show, and must leave nothing behind.
 *
 * The session is mocked as in `api-tokens.test.ts`, so every request here is
 * signed in as the group's owner and gets all the way to the write.
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
const notificationsRoute = await import("@/app/api/notifications/route");

beforeEach(() => {
  cookieActor.value = null;
});

async function signedInGroup() {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, { name: "Lisbon" });
  cookieActor.value = owner;
  return group;
}

function context(groupId: string) {
  return { params: Promise.resolve({ groupId }) } as never;
}

function postExpense(
  groupId: string,
  participantId: string,
  overrides: Record<string, unknown>,
) {
  return expensesRoute.POST(
    new Request(`http://localhost/api/groups/${groupId}/expenses`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        description: "Dinner",
        amount: "2500",
        currency: "EUR",
        expenseDate: "2026-09-01",
        payers: [{ participantId, amount: "2500" }],
        splitMethod: "equal",
        splitEntries: [{ participantId }],
        ...overrides,
      }),
    }),
    context(groupId),
  );
}

async function storedExpenses(groupId: string) {
  return getDb()
    .select({ id: expenses.id })
    .from(expenses)
    .where(eq(expenses.groupId, groupId));
}

describe("POST /api/groups/:groupId/expenses", () => {
  it("answers 422 to a day the calendar does not have", async () => {
    const group = await signedInGroup();

    const response = await postExpense(
      group.groupId,
      group.ownerParticipantId,
      { expenseDate: "2025-02-30" },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Not a real date" });
    expect(await storedExpenses(group.groupId)).toEqual([]);
  });

  it("answers 422 to a year PostgreSQL has no room for", async () => {
    const group = await signedInGroup();

    const response = await postExpense(
      group.groupId,
      group.ownerParticipantId,
      { expenseDate: "0000-01-01" },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({
      error: "Choose a date between 1900 and 2999",
    });
    expect(await storedExpenses(group.groupId)).toEqual([]);
  });

  it("answers 422 to an amount that is not a number", async () => {
    // The schema itself used to throw on this one — `BigInt("abc")` in a
    // refinement zod runs after the failed pattern — before any query at all.
    const group = await signedInGroup();

    const response = await postExpense(
      group.groupId,
      group.ownerParticipantId,
      { amount: "abc" },
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toEqual({ error: "Enter a valid amount" });
    expect(await storedExpenses(group.groupId)).toEqual([]);
  });

  it("still records a leap day", async () => {
    const group = await signedInGroup();

    const response = await postExpense(
      group.groupId,
      group.ownerParticipantId,
      { expenseDate: "2024-02-29" },
    );

    expect(response.status).toBe(201);
    expect(await storedExpenses(group.groupId)).toHaveLength(1);
  });
});

describe("GET /api/notifications", () => {
  function inbox(before: string) {
    return notificationsRoute.GET(
      new Request(
        `http://localhost/api/notifications?before=${encodeURIComponent(before)}`,
      ),
    );
  }

  it("answers 400 to a `before` older than any timestamp", async () => {
    // A real instant to JavaScript, and thousands of years before the first
    // one PostgreSQL can compare against — which it said as a failed query.
    const before = "-271821-04-20T00:00:00.000Z";
    expect(Number.isNaN(new Date(before).getTime())).toBe(false);
    await signedInGroup();

    expect((await inbox(before)).status).toBe(400);
  });

  it("still pages from an instant inside the calendar", async () => {
    await signedInGroup();

    expect((await inbox("2026-09-01T12:00:00.000Z")).status).toBe(200);
  });
});
