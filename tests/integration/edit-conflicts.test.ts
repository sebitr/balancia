import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPool } from "@/lib/db/client";
import { expensePayers, expenseShares, expenses } from "@/lib/db/schema";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import { EditConflictError } from "@/modules/expenses/edit-conflict";
import {
  createExpense,
  getExpense,
  updateExpense,
} from "@/modules/expenses/service";
import {
  createSettlement,
  getSettlement,
  updateSettlement,
} from "@/modules/settlements/service";
import { loadGroupBalances } from "@/modules/balances/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
  type TestGroup,
} from "../helpers/factories";

/**
 * Two people, one entry, and the edit that used to win by arriving second.
 *
 * An edit replaces the whole entry, so the second of two saves made from the
 * same copy put back everything the first had corrected, and nobody was told.
 * These pin down the refusal: the stale edit is turned away, the first one
 * stands, and a caller that never read a version keeps the old behaviour.
 *
 * The API half runs through the route handlers, with the cookie path mocked to
 * answer as the group's owner, because the header is read there and nowhere
 * else.
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

const expenseRoute =
  await import("@/app/api/groups/[groupId]/expenses/[expenseId]/route");
const settlementRoute =
  await import("@/app/api/groups/[groupId]/settlements/[settlementId]/route");

beforeEach(() => {
  cookieActor.value = null;
});

/** The version format: UTC, six fractional digits, never a `Date`'s three. */
const VERSION = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

function dinner(
  group: TestGroup,
  other: string,
  overrides: { description?: string; amount?: string } = {},
) {
  const amount = overrides.amount ?? "3000";
  return {
    description: overrides.description ?? "Dinner",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: group.ownerParticipantId, amount }],
    splitMethod: "equal" as const,
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: other },
    ],
  };
}

function repayment(group: TestGroup, other: string, amount = "1500") {
  return {
    fromParticipantId: other,
    toParticipantId: group.ownerParticipantId,
    amount,
    currency: "EUR",
    exchangeRate: "",
    settledOn: isoToday(),
    paymentMethod: "",
    notes: "",
  };
}

async function setup() {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner);
  const other = await addTestParticipant(group.groupId, "Blaise");
  return { owner, group, other };
}

describe("editing an expense from a copy", () => {
  it("hands out a version to the microsecond, and moves it on every edit", async () => {
    const { group, other } = await setup();
    const id = await createExpense(group.access, dinner(group, other));

    const read = await getExpense(group.groupId, id);
    expect(read!.version).toMatch(VERSION);

    // Two edits in quick succession, well inside one millisecond of each
    // other on a fast machine. A millisecond clock would stamp both alike and
    // leave the second undetectable.
    const first = await updateExpense(group.access, id, dinner(group, other), {
      expectedVersion: read!.version,
    });
    const second = await updateExpense(group.access, id, dinner(group, other), {
      expectedVersion: first,
    });

    expect(first).toMatch(VERSION);
    expect(second).toMatch(VERSION);
    expect(first > read!.version).toBe(true);
    expect(second > first).toBe(true);
    expect((await getExpense(group.groupId, id))!.version).toBe(second);
  });

  it("lets the first of two stale edits land and refuses the second", async () => {
    const { group, other } = await setup();
    const id = await createExpense(group.access, dinner(group, other));
    const { version } = (await getExpense(group.groupId, id))!;

    // Both people opened the same copy.
    await updateExpense(
      group.access,
      id,
      dinner(group, other, {
        description: "Dinner at Nonna's",
        amount: "4200",
      }),
      { expectedVersion: version },
    );

    await expect(
      updateExpense(
        group.access,
        id,
        dinner(group, other, { description: "Pizza", amount: "1000" }),
        { expectedVersion: version },
      ),
    ).rejects.toBeInstanceOf(EditConflictError);

    // The first edit stands, all of it — the refused one wrote nothing, not
    // even the allocations it replaces before the row.
    const after = (await getExpense(group.groupId, id))!;
    expect(after.description).toBe("Dinner at Nonna's");
    expect(after.amount).toBe(4200n);
    expect(after.payers.map((payer) => payer.amount)).toEqual([4200n]);
    expect(after.shares.reduce((sum, share) => sum + share.amount, 0n)).toBe(
      4200n,
    );
  });

  it("refuses two edits racing from one copy, whichever commits first", async () => {
    const { group, other } = await setup();
    const id = await createExpense(group.access, dinner(group, other));
    const { version } = (await getExpense(group.groupId, id))!;

    const outcomes = await Promise.allSettled([
      updateExpense(
        group.access,
        id,
        dinner(group, other, { amount: "1111" }),
        {
          expectedVersion: version,
        },
      ),
      updateExpense(
        group.access,
        id,
        dinner(group, other, { amount: "2222" }),
        {
          expectedVersion: version,
        },
      ),
    ]);

    const landed = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const refused = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(landed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect((refused[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      EditConflictError,
    );
  });

  it("applies unconditionally when no version is given, as it always did", async () => {
    const { group, other } = await setup();
    const id = await createExpense(group.access, dinner(group, other));
    const { version } = (await getExpense(group.groupId, id))!;

    await updateExpense(group.access, id, dinner(group, other), {
      expectedVersion: version,
    });
    // A caller that never read one — the iOS client as it ships today.
    await updateExpense(
      group.access,
      id,
      dinner(group, other, { description: "Late edit" }),
    );

    expect((await getExpense(group.groupId, id))!.description).toBe(
      "Late edit",
    );
  });

  it("treats a version it never issued as stale rather than as absent", async () => {
    const { group, other } = await setup();
    const id = await createExpense(group.access, dinner(group, other));

    await expect(
      updateExpense(group.access, id, dinner(group, other), {
        expectedVersion: "not-a-version",
      }),
    ).rejects.toBeInstanceOf(EditConflictError);
  });
});

describe("editing a repayment from a copy", () => {
  it("lets the first of two stale edits land and refuses the second", async () => {
    const { group, other } = await setup();
    const id = await createSettlement(group.access, repayment(group, other));
    const { version } = (await getSettlement(group.groupId, id))!;
    expect(version).toMatch(VERSION);

    const next = await updateSettlement(
      group.access,
      id,
      repayment(group, other, "1600"),
      { expectedVersion: version },
    );
    expect(next > version).toBe(true);

    await expect(
      updateSettlement(group.access, id, repayment(group, other, "900"), {
        expectedVersion: version,
      }),
    ).rejects.toBeInstanceOf(EditConflictError);

    expect((await getSettlement(group.groupId, id))!.amount).toBe(1600n);

    // And without a version, as before.
    await updateSettlement(group.access, id, repayment(group, other, "700"));
    expect((await getSettlement(group.groupId, id))!.amount).toBe(700n);
  });
});

describe("the precondition over the API", () => {
  function patch(path: string, body: unknown, ifMatch: string | null): Request {
    return new Request(`http://localhost${path}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        ...(ifMatch === null ? {} : { "If-Match": ifMatch }),
      },
      body: JSON.stringify(body),
    });
  }

  it("sends the version as an ETag, honours If-Match, and answers 409 on a stale one", async () => {
    const { owner, group, other } = await setup();
    cookieActor.value = owner;
    const id = await createExpense(group.access, dinner(group, other));
    const path = `/api/groups/${group.groupId}/expenses/${id}`;
    const context = {
      params: Promise.resolve({ groupId: group.groupId, expenseId: id }),
    } as never;

    const read = await expenseRoute.GET(
      new Request(`http://localhost${path}`),
      context,
    );
    expect(read.status).toBe(200);
    const { expense } = (await read.json()) as {
      expense: { version: string };
    };
    expect(expense.version).toMatch(VERSION);
    expect(read.headers.get("ETag")).toBe(`"${expense.version}"`);

    const first = await expenseRoute.PATCH(
      patch(
        path,
        dinner(group, other, { description: "Mine" }),
        `"${expense.version}"`,
      ),
      context,
    );
    expect(first.status).toBe(200);
    const landed = (await first.json()) as { version: string };
    expect(first.headers.get("ETag")).toBe(`"${landed.version}"`);

    // The same stale tag again: somebody else's edit is in the way now.
    const stale = await expenseRoute.PATCH(
      patch(
        path,
        dinner(group, other, { description: "Theirs" }),
        `"${expense.version}"`,
      ),
      context,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "editConflict" });
    expect((await getExpense(group.groupId, id))!.description).toBe("Mine");

    // A proxy that weakened the tag does not turn a good edit into a refusal.
    const weak = await expenseRoute.PATCH(
      patch(
        path,
        dinner(group, other, { description: "Weak" }),
        `W/"${landed.version}"`,
      ),
      context,
    );
    expect(weak.status).toBe(200);

    // And no header at all is the old, unconditional behaviour.
    const bare = await expenseRoute.PATCH(
      patch(path, dinner(group, other, { description: "Bare" }), null),
      context,
    );
    expect(bare.status).toBe(200);
    expect((await getExpense(group.groupId, id))!.description).toBe("Bare");
  });

  it("does the same for a repayment", async () => {
    const { owner, group, other } = await setup();
    cookieActor.value = owner;
    const id = await createSettlement(group.access, repayment(group, other));
    const path = `/api/groups/${group.groupId}/settlements/${id}`;
    const context = {
      params: Promise.resolve({ groupId: group.groupId, settlementId: id }),
    } as never;

    const read = await settlementRoute.GET(
      new Request(`http://localhost${path}`),
      context,
    );
    const etag = read.headers.get("ETag")!;
    expect(etag).toMatch(/^".+"$/);

    const first = await settlementRoute.PATCH(
      patch(path, repayment(group, other, "1600"), etag),
      context,
    );
    expect(first.status).toBe(200);

    const stale = await settlementRoute.PATCH(
      patch(path, repayment(group, other, "900"), etag),
      context,
    );
    expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ code: "editConflict" });

    const bare = await settlementRoute.PATCH(
      patch(path, repayment(group, other, "800"), null),
      context,
    );
    expect(bare.status).toBe(200);
    expect((await getSettlement(group.groupId, id))!.amount).toBe(800n);
  });
});

describe("reading balances while somebody edits", () => {
  /*
   * The race, made to happen on purpose.
   *
   * A second connection takes a lock on `expense_shares` that no read can get
   * past, and the balance loader is started. It reads the participants, the
   * expenses and the payers, and then stops on the shares. While it is stopped
   * there, the lock holder edits the expense — new payers and new shares, both
   * balanced — and commits, which releases the lock.
   *
   * Read statement by statement, the loader now sees the old payers beside the
   * new shares, an expense that does not balance, and throws. Read from one
   * snapshot it sees the expense as it was when it started, whole.
   */
  it("sees one snapshot, never half of an edit that committed mid-read", async () => {
    const { group, other } = await setup();
    const id = await createExpense(group.access, dinner(group, other));

    const editor = await getPool().connect();
    let released = false;
    try {
      await editor.query("BEGIN");
      await editor.query("LOCK TABLE expense_shares IN ACCESS EXCLUSIVE MODE");

      const reading = loadGroupBalances(group.access);
      // Settled before anything awaits it, so a rejection is never unhandled.
      const outcome = reading.then(
        (value) => ({ ok: true as const, value }),
        (error: unknown) => ({ ok: false as const, error }),
      );

      // A client connection in this database, so neither autovacuum nor a
      // suite running against another database on the same server can pass
      // for the loader: a wait that is not the loader's would let the edit
      // commit before its snapshot was taken.
      await waitUntil(async () => {
        const { rows } = await getPool().query<{ waiting: number }>(
          `SELECT count(*)::int AS waiting
           FROM pg_locks l JOIN pg_stat_activity a ON a.pid = l.pid
           WHERE l.database = (SELECT oid FROM pg_database WHERE datname = current_database())
             AND l.relation = 'expense_shares'::regclass
             AND NOT l.granted
             AND a.backend_type = 'client backend'`,
        );
        return (rows[0]?.waiting ?? 0) > 0;
      });

      // The expense becomes 50.00, paid by Blaise, split evenly — balanced on
      // its own, and unbalanced against the payers the loader already holds.
      await editor.query(
        "UPDATE expense_payers SET amount = 5000, participant_id = $2 WHERE expense_id = $1",
        [id, other],
      );
      await editor.query(
        "UPDATE expense_shares SET amount = 2500 WHERE expense_id = $1",
        [id],
      );
      await editor.query("UPDATE expenses SET amount = 5000 WHERE id = $1", [
        id,
      ]);
      await editor.query("COMMIT");
      released = true;

      const result = await outcome;
      if (!result.ok) throw result.error;

      // The expense as it stood when the read began: Ada paid 30.00 of which
      // her share was 15.00, so Blaise owes her 15.00.
      expect(balanceOf(result.value, group.ownerParticipantId)).toBe(1500n);
      expect(balanceOf(result.value, other)).toBe(-1500n);
    } finally {
      if (!released) await editor.query("ROLLBACK");
      editor.release();
    }

    // And the edit did land: a fresh read sees it, whole.
    const [payer] = await getDb()
      .select()
      .from(expensePayers)
      .where(eq(expensePayers.expenseId, id));
    expect(payer!.amount).toBe(5000n);
    const shares = await getDb()
      .select()
      .from(expenseShares)
      .where(eq(expenseShares.expenseId, id));
    expect(shares.map((share) => share.amount)).toEqual([2500n, 2500n]);
    const [row] = await getDb()
      .select({ amount: expenses.amount })
      .from(expenses)
      .where(eq(expenses.id, id));
    expect(row!.amount).toBe(5000n);

    const fresh = await loadGroupBalances(group.access);
    expect(balanceOf(fresh, group.ownerParticipantId)).toBe(-2500n);
    expect(balanceOf(fresh, other)).toBe(2500n);
  });
});

function balanceOf(
  balances: Awaited<ReturnType<typeof loadGroupBalances>>,
  participantId: string,
): bigint | undefined {
  return balances.currencies
    .find((entry) => entry.currency === "EUR")
    ?.balances.find((entry) => entry.participantId === participantId)?.amount;
}

async function waitUntil(
  condition: () => Promise<boolean>,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Timed out waiting for the balance read to block");
}
