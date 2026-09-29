import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPool, type Database } from "@/lib/db/client";
import { expenseShares, expenses, participants } from "@/lib/db/schema";
import {
  AuthorizationError,
  type GuestActor,
  type UserActor,
} from "@/lib/security/authorization";
import { OpenBalanceError } from "@/modules/balances/open-balance";
import { loadGroupBalances } from "@/modules/balances/service";
import { createExpense, updateExpense } from "@/modules/expenses/service";
import type { ExpenseInput, SettlementInput } from "@/modules/expenses/schemas";
import { removeParticipant } from "@/modules/groups/service";
import {
  createSettlement,
  deleteSettlement,
  updateSettlement,
} from "@/modules/settlements/service";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
  type TestGroup,
} from "../helpers/factories";

/**
 * Removing somebody from a group, and what they can still be part of after.
 *
 * A removed person stays in every balance their history touches, and no new
 * entry may name them. Those two rules together used to strand money: somebody
 * removed through the API, or in the same instant as an expense naming them
 * landed, was left owing a debt the settle screen showed and nothing could
 * record. And an old expense naming them could not have its description fixed
 * without dropping them from the split, which rewrote the very history the
 * removal promised to keep.
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

const { DELETE } =
  await import("@/app/api/groups/[groupId]/participants/[participantId]/route");

beforeEach(() => {
  currentActor.value = null;
});

/** Paid by `payer`, split equally between them and `others`. */
function dinner(
  payer: string,
  others: readonly string[],
  amount = "3000",
  currency = "EUR",
): ExpenseInput {
  return {
    description: "Dinner",
    notes: "",
    category: "",
    amount,
    currency,
    exchangeRate: "",
    expenseDate: isoToday(),
    payers: [{ participantId: payer, amount }],
    splitMethod: "equal",
    splitEntries: [payer, ...others].map((participantId) => ({
      participantId,
    })),
  };
}

function repayment(
  from: string,
  to: string,
  amount: string,
  extra: Partial<SettlementInput> = {},
): SettlementInput {
  return {
    fromParticipantId: from,
    toParticipantId: to,
    amount,
    currency: "EUR",
    exchangeRate: "",
    settledOn: isoToday(),
    notes: "",
    ...extra,
  };
}

async function removedAt(participantId: string): Promise<Date | null> {
  const [row] = await getDb()
    .select({ removedAt: participants.removedAt })
    .from(participants)
    .where(eq(participants.id, participantId));
  return row?.removedAt ?? null;
}

async function balanceOf(
  group: TestGroup,
  participantId: string,
  currency = "EUR",
): Promise<bigint> {
  const balances = await loadGroupBalances(group.access);
  return (
    balances.currencies
      .find((entry) => entry.currency === currency)
      ?.balances.find((row) => row.participantId === participantId)?.amount ??
    0n
  );
}

/** Bob, who shared a dinner with the owner and has since paid his half back. */
async function squareBob(group: TestGroup) {
  const bob = await addTestParticipant(group.groupId, "Bob");
  const expenseId = await createExpense(
    group.access,
    dinner(group.ownerParticipantId, [bob]),
  );
  const settlementId = await createSettlement(
    group.access,
    repayment(bob, group.ownerParticipantId, "1500"),
  );
  return { bob, expenseId, settlementId };
}

describe("removing somebody over the API", () => {
  function context(groupId: string, participantId: string) {
    return { params: Promise.resolve({ groupId, participantId }) } as never;
  }

  function request(): Request {
    return new Request("http://localhost/api/groups/x/participants/y", {
      method: "DELETE",
    });
  }

  it("refuses with 422 while they are still owed, and leaves them in", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const bob = await addTestParticipant(group.groupId, "Bob");
    await createExpense(group.access, dinner(bob, [group.ownerParticipantId]));
    currentActor.value = owner;

    const response = await DELETE(request(), context(group.groupId, bob));

    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toContain("Bob");
    expect(body.error).toContain("Settle up first");
    expect(await removedAt(bob)).toBeNull();
  });

  it("removes them once they are square", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob } = await squareBob(group);
    currentActor.value = owner;

    const response = await DELETE(request(), context(group.groupId, bob));

    expect(response.status).toBe(200);
    expect(await removedAt(bob)).not.toBeNull();
  });

  /**
   * A group that keeps its currencies apart can have somebody square in one
   * and owed in another. Summing across them would call that square; the
   * screen lists each currency, and so does the refusal.
   */
  it("counts every currency, not their sum", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob } = await squareBob(group);
    await createExpense(
      group.access,
      dinner(bob, [group.ownerParticipantId], "2000", "CHF"),
    );

    await expect(removeParticipant(group.access, bob)).rejects.toThrow(
      OpenBalanceError,
    );
    expect(await removedAt(bob)).toBeNull();
  });
});

/**
 * A database whose transactions do all their work, then wait to commit until
 * told to.
 *
 * It is how the two orders below are made to happen on purpose rather than by
 * luck: one write is held open with its locks taken while the other runs into
 * it, and only then let go.
 */
function heldBeforeCommit(): {
  db: Database;
  reached: Promise<void>;
  commit: () => void;
} {
  const real = getDb();
  let reach = () => {};
  const reached = new Promise<void>((resolve) => {
    reach = resolve;
  });
  let commit = () => {};
  const released = new Promise<void>((resolve) => {
    commit = resolve;
  });
  const db = new Proxy(real, {
    get(target, property, receiver) {
      if (property !== "transaction") {
        return Reflect.get(target, property, receiver);
      }
      return (body: Parameters<Database["transaction"]>[0]) =>
        target.transaction(async (tx) => {
          const result = await body(tx);
          reach();
          await released;
          return result;
        });
    },
  });
  return { db, reached, commit };
}

/**
 * Until another connection is waiting on a row lock — or `other` has finished
 * without ever having to, which is what happens when the lock is missing.
 */
async function untilBlocked(other: Promise<unknown>): Promise<void> {
  let settled = false;
  const done = () => {
    settled = true;
  };
  void other.then(done, done);
  const deadline = Date.now() + 10_000;
  while (!settled && Date.now() < deadline) {
    const { rows } = await getPool().query<{ waiting: number }>(
      `SELECT count(*)::int AS waiting FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'`,
    );
    if ((rows[0]?.waiting ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("an expense and a removal at the same moment", () => {
  it("lets an expense that got there first stop the removal", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob } = await squareBob(group);

    const held = heldBeforeCommit();
    const expense = createExpense(
      group.access,
      dinner(bob, [group.ownerParticipantId]),
      { db: held.db },
    );
    await held.reached;

    const removal = removeParticipant(group.access, bob);
    await untilBlocked(removal);
    held.commit();

    const [expenseResult, removalResult] = await Promise.allSettled([
      expense,
      removal,
    ]);
    expect(expenseResult.status).toBe("fulfilled");
    expect(removalResult.status).toBe("rejected");
    expect(
      removalResult.status === "rejected" && removalResult.reason,
    ).toBeInstanceOf(OpenBalanceError);
    expect(await removedAt(bob)).toBeNull();
    expect(await balanceOf(group, bob)).toBe(1500n);
  });

  it("lets a removal that got there first stop the expense", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob } = await squareBob(group);

    const held = heldBeforeCommit();
    const removal = removeParticipant(group.access, bob, { db: held.db });
    await held.reached;

    const expense = createExpense(
      group.access,
      dinner(bob, [group.ownerParticipantId], "4000"),
    );
    await untilBlocked(expense);
    held.commit();

    const [removalResult, expenseResult] = await Promise.allSettled([
      removal,
      expense,
    ]);
    expect(removalResult.status).toBe("fulfilled");
    expect(expenseResult.status).toBe("rejected");
    expect(
      expenseResult.status === "rejected" && expenseResult.reason,
    ).toBeInstanceOf(AuthorizationError);
    expect(await removedAt(bob)).not.toBeNull();
    expect(await balanceOf(group, bob)).toBe(0n);
  });
});

describe("an entry that names somebody who has left", () => {
  it("can still have its description corrected", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob, expenseId, settlementId } = await squareBob(group);
    await removeParticipant(group.access, bob);

    await updateExpense(group.access, expenseId, {
      ...dinner(group.ownerParticipantId, [bob]),
      description: "Dinner at Maria's",
    });
    await updateSettlement(
      group.access,
      settlementId,
      repayment(bob, group.ownerParticipantId, "1500", { notes: "Cash" }),
    );

    const [row] = await getDb()
      .select({ description: expenses.description })
      .from(expenses)
      .where(eq(expenses.id, expenseId));
    expect(row?.description).toBe("Dinner at Maria's");
    // Still on the split: the edit kept the history rather than rewriting it.
    const shares = await getDb()
      .select({ participantId: expenseShares.participantId })
      .from(expenseShares)
      .where(eq(expenseShares.expenseId, expenseId));
    expect(shares.map((share) => share.participantId)).toContain(bob);
    expect(await balanceOf(group, bob)).toBe(0n);
  });

  it("cannot be given them if they were not on it", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob } = await squareBob(group);
    const carol = await addTestParticipant(group.groupId, "Carol");
    const withoutBob = await createExpense(
      group.access,
      dinner(group.ownerParticipantId, [carol]),
    );
    const carolPaid = await createSettlement(
      group.access,
      repayment(carol, group.ownerParticipantId, "1500"),
    );
    await removeParticipant(group.access, bob);

    await expect(
      updateExpense(
        group.access,
        withoutBob,
        dinner(group.ownerParticipantId, [carol, bob]),
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      updateSettlement(
        group.access,
        carolPaid,
        repayment(bob, group.ownerParticipantId, "1500"),
      ),
    ).rejects.toThrow(AuthorizationError);
    await expect(
      createExpense(group.access, dinner(group.ownerParticipantId, [bob])),
    ).rejects.toThrow(AuthorizationError);
  });
});

/**
 * A removal is only allowed at zero, but zero does not have to last: deleting a
 * repayment somebody made, or editing an old expense they shared, moves their
 * balance after they have gone. What is left is a debt with a name on it, and
 * a repayment is allowed to clear it — and only to clear it.
 */
describe("a repayment with somebody who has left", () => {
  async function bobOwesAgain() {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob, settlementId } = await squareBob(group);
    await removeParticipant(group.access, bob);
    await deleteSettlement(group.access, settlementId);
    expect(await balanceOf(group, bob)).toBe(-1500n);
    return { group, bob };
  }

  it("clears what they still owe", async () => {
    const { group, bob } = await bobOwesAgain();

    await createSettlement(
      group.access,
      repayment(bob, group.ownerParticipantId, "1000"),
    );
    await createSettlement(
      group.access,
      repayment(bob, group.ownerParticipantId, "500"),
    );

    expect(await balanceOf(group, bob)).toBe(0n);
  });

  it("refuses to pay them more than they are owed, or the wrong way", async () => {
    const { group, bob } = await bobOwesAgain();

    // More than the debt would leave them owed the difference instead.
    await expect(
      createSettlement(
        group.access,
        repayment(bob, group.ownerParticipantId, "1501"),
      ),
    ).rejects.toThrow(OpenBalanceError);
    // Paying somebody who owes makes the debt bigger.
    await expect(
      createSettlement(
        group.access,
        repayment(group.ownerParticipantId, bob, "100"),
      ),
    ).rejects.toThrow(OpenBalanceError);
    expect(await balanceOf(group, bob)).toBe(-1500n);
  });

  it("refuses to name them at all once they are square", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner);
    const { bob } = await squareBob(group);
    await removeParticipant(group.access, bob);

    await expect(
      createSettlement(
        group.access,
        repayment(group.ownerParticipantId, bob, "100"),
      ),
    ).rejects.toThrow(OpenBalanceError);
  });

  /**
   * A group that converts keeps its balances in the base currency, so a
   * repayment in anything else is measured by what it converts to.
   */
  it("measures a foreign repayment by what it converts to", async () => {
    const owner = await createTestUser();
    const group = await createTestGroup(owner, {
      currencyMode: "converted",
      baseCurrency: "EUR",
    });
    const { bob, settlementId } = await squareBob(group);
    await removeParticipant(group.access, bob);
    await deleteSettlement(group.access, settlementId);

    const inFrancs = (amount: string) =>
      repayment(bob, group.ownerParticipantId, amount, {
        currency: "CHF",
        exchangeRate: "0.5",
      });

    // 3002 centimes at 0.5 is 1501 cents: one more than Bob owes.
    await expect(
      createSettlement(group.access, inFrancs("3002")),
    ).rejects.toThrow(OpenBalanceError);
    await createSettlement(group.access, inFrancs("3000"));

    expect(await balanceOf(group, bob)).toBe(0n);
  });
});
