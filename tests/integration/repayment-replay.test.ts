import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/lib/db/client";
import { expenses, settlements } from "@/lib/db/schema";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import { createExpense } from "@/modules/expenses/service";
import { createSettlement } from "@/modules/settlements/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * A repayment sent twice, through the doors a client actually uses: the mobile
 * API's route and the web form's Server Actions.
 *
 * The services underneath are tested for the guarantee itself in
 * `expenses.test.ts`. What is tested here is that each door hands the key
 * through — a route that parsed the header and dropped it, or an action that
 * took the argument and never passed it on, would leave every one of those
 * tests green and every repayment unprotected.
 *
 * The signed-in person arrives by cookie, mocked, as in `api-tokens.test.ts`.
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

// An action revalidates the pages it changed, which needs the request Next
// would be serving. There is none here, and what is under test is what the
// action wrote, not what it asked Next to redraw.
vi.mock("next/cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/cache")>()),
  revalidatePath: vi.fn(),
}));

const settlementsRoute =
  await import("@/app/api/groups/[groupId]/settlements/route");
const settlementRoute =
  await import("@/app/api/groups/[groupId]/settlements/[settlementId]/route");
const actions = await import("@/modules/expenses/actions");

beforeEach(() => {
  cookieActor.value = null;
});

async function setup() {
  const owner = await createTestUser({ name: "Seb" });
  const group = await createTestGroup(owner);
  const blaise = await addTestParticipant(group.groupId, "Blaise");
  cookieActor.value = owner;

  const repayment = {
    fromParticipantId: blaise,
    toParticipantId: group.ownerParticipantId,
    amount: "2500",
    currency: "EUR",
    settledOn: isoToday(),
    paymentMethod: "TWINT",
  };
  const lunch = {
    description: "Lunch",
    amount: "5000",
    currency: "EUR",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount: "5000" }],
    splitMethod: "equal" as const,
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: blaise },
    ],
  };

  return { group, repayment, lunch };
}

function post(groupId: string, body: unknown, key?: string): Request {
  return new Request(`http://localhost/api/groups/${groupId}/settlements`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key === undefined ? {} : { "Idempotency-Key": key }),
    },
    body: JSON.stringify(body),
  });
}

function liveSettlements(groupId: string) {
  return getDb()
    .select()
    .from(settlements)
    .where(
      and(eq(settlements.groupId, groupId), isNull(settlements.deletedAt)),
    );
}

function liveExpenses(groupId: string) {
  return getDb()
    .select()
    .from(expenses)
    .where(and(eq(expenses.groupId, groupId), isNull(expenses.deletedAt)));
}

describe("POST /api/groups/:groupId/settlements", () => {
  const context = (groupId: string) =>
    ({ params: Promise.resolve({ groupId }) }) as never;

  it("answers a replay with the repayment the first call wrote", async () => {
    const { group, repayment } = await setup();
    const key = randomUUID();

    const first = await settlementsRoute.POST(
      post(group.groupId, repayment, key),
      context(group.groupId),
    );
    const second = await settlementsRoute.POST(
      post(group.groupId, repayment, key),
      context(group.groupId),
    );

    // The same answer both times, as the expenses route gives: the only thing
    // a client's queue needs to know is that the server has it.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    const written = await first.json();
    expect(await second.json()).toEqual(written);
    expect(await liveSettlements(group.groupId)).toEqual([
      expect.objectContaining({ id: written.settlementId }),
    ]);
  });

  it("writes a second repayment under a second key", async () => {
    const { group, repayment } = await setup();

    await settlementsRoute.POST(
      post(group.groupId, repayment, randomUUID()),
      context(group.groupId),
    );
    await settlementsRoute.POST(
      post(group.groupId, repayment, randomUUID()),
      context(group.groupId),
    );

    expect(await liveSettlements(group.groupId)).toHaveLength(2);
  });

  it("ignores a key it cannot store, as the expenses route does", async () => {
    // Not a UUID, so not a key: the write lands, unprotected, rather than
    // being refused with a 400 a queue would retry forever.
    const { group, repayment } = await setup();

    const first = await settlementsRoute.POST(
      post(group.groupId, repayment, "retry-1"),
      context(group.groupId),
    );
    await settlementsRoute.POST(
      post(group.groupId, repayment, "retry-1"),
      context(group.groupId),
    );

    expect(first.status).toBe(201);
    expect(await liveSettlements(group.groupId)).toHaveLength(2);
  });
});

describe("PATCH /api/groups/:groupId/settlements/:settlementId", () => {
  it("saves the payment method it is sent", async () => {
    const { group, repayment } = await setup();
    const settlementId = await createSettlement(group.access, repayment);
    const context = {
      params: Promise.resolve({ groupId: group.groupId, settlementId }),
    } as never;
    const path = `http://localhost/api/groups/${group.groupId}/settlements/${settlementId}`;

    const patched = await settlementRoute.PATCH(
      new Request(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...repayment, paymentMethod: "Cash" }),
      }),
      context,
    );
    expect(patched.status).toBe(200);

    const read = await settlementRoute.GET(new Request(path), context);
    expect((await read.json()).settlement.paymentMethod).toBe("Cash");
  });
});

describe("the form's actions", () => {
  it("records a repayment once when the same press is sent twice", async () => {
    const { group, repayment } = await setup();
    const key = randomUUID();

    const first = await actions.createSettlementAction(
      group.groupId,
      repayment,
      key,
    );
    const second = await actions.createSettlementAction(
      group.groupId,
      repayment,
      key,
    );

    expect(first.ok).toBe(true);
    expect(second.data).toEqual(first.data);
    expect(await liveSettlements(group.groupId)).toHaveLength(1);
  });

  it("turns an expense into one repayment however often the move is sent", async () => {
    const { group, repayment, lunch } = await setup();
    const expenseId = await createExpense(group.access, lunch);
    const key = randomUUID();

    const first = await actions.convertExpenseToSettlementAction(
      group.groupId,
      expenseId,
      repayment,
      key,
    );
    const second = await actions.convertExpenseToSettlementAction(
      group.groupId,
      expenseId,
      repayment,
      key,
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await liveSettlements(group.groupId)).toHaveLength(1);
    expect(await liveExpenses(group.groupId)).toHaveLength(0);
  });

  it("turns a repayment into one expense however often the move is sent", async () => {
    const { group, repayment, lunch } = await setup();
    const settlementId = await createSettlement(group.access, repayment);
    const key = randomUUID();

    const first = await actions.convertSettlementToExpenseAction(
      group.groupId,
      settlementId,
      lunch,
      key,
    );
    const second = await actions.convertSettlementToExpenseAction(
      group.groupId,
      settlementId,
      lunch,
      key,
    );

    expect(first.ok).toBe(true);
    expect(second).toEqual(first);
    expect(await liveExpenses(group.groupId)).toHaveLength(1);
    expect(await liveSettlements(group.groupId)).toHaveLength(0);
  });
});
