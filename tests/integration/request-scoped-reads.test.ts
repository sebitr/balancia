import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getDb, getPool } from "@/lib/db/client";
import { expenses, groupMembers, participants } from "@/lib/db/schema";
import {
  AuthorizationError,
  type GuestActor,
  type UserActor,
} from "@/lib/security/authorization";
import {
  loadGroupBalances,
  type GroupBalances,
} from "@/modules/balances/service";
import { createExpense } from "@/modules/expenses/service";
import { loadGroupOverview } from "@/modules/groups/overview";
import { removeParticipant, setGroupArchived } from "@/modules/groups/service";
import { listClaimableMembers, loadJoinSummary } from "@/modules/join/service";
import { listRemindRecipients } from "@/modules/reminders/service";
import { createSettlement } from "@/modules/settlements/service";
import { loadSettleUp } from "@/modules/settlements/settle-up";
import {
  addTestParticipant,
  createTestGroup,
  createTestUser,
  isoToday,
  type TestGroup,
} from "../helpers/factories";

/**
 * What one render reads, and that nothing it remembers outlives it.
 *
 * The balance loader's reads (through `oncePerRender`) and
 * `requireGroupAccess` are wrapped in React's `cache`, which is what makes a
 * screen that asks twice read once. But the
 * `react` this suite resolves is the client build, where `cache` is a bare
 * pass-through — so the suite would pass with the memo missing and prove
 * nothing. The server build is swapped in instead, and given the one piece of
 * the React Flight renderer that `cache` consults: a dispatcher whose
 * `getCacheForType` answers from the current render's map, or from a fresh
 * map when there is no render at all. That is the renderer's
 * `DefaultAsyncDispatcher` line for line, and `inRender` below is what a
 * Flight request is to it — a new map, held in async-local storage for as long
 * as the render runs.
 *
 * What stands in for a Server Action is simply code run outside `inRender`,
 * because that is where Next.js runs one: `executeActionAndPrepareForRender`
 * awaits the action to completion first, and only then does `generateFlight`
 * start the render that follows it, as a new Flight request with a new map.
 */

const render = await vi.hoisted(async () => {
  const { AsyncLocalStorage } = await import("node:async_hooks");
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const serverReact = require(
    require
      .resolve("react/package.json")
      .replace(/package\.json$/, "react.react-server.js"),
  ) as {
    cache: typeof import("react").cache;
    __SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      A: unknown;
    };
  };

  const current = new AsyncLocalStorage<Map<unknown, unknown>>();
  serverReact.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE.A =
    {
      getCacheForType(resourceType: () => unknown) {
        const cache = current.getStore() ?? new Map();
        let entry = cache.get(resourceType);
        if (entry === undefined) {
          entry = resourceType();
          cache.set(resourceType, entry);
        }
        return entry;
      },
    };

  return {
    cache: serverReact.cache,
    /** Runs `body` as one server render, with a memo of its own. */
    inRender<T>(body: () => Promise<T>): Promise<T> {
      return current.run(new Map(), body);
    },
  };
});

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: render.cache,
}));

// Whoever the request is from; the cookie path is not what is under test.
const cookieActor = vi.hoisted(() => ({
  value: null as UserActor | GuestActor | null,
}));
vi.mock("@/lib/security/actor", () => ({
  getCurrentActor: async () => cookieActor.value,
  getCurrentUser: async () =>
    cookieActor.value?.kind === "user" ? cookieActor.value : null,
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));

const { requireGroupAccess } = await import("@/lib/actions");

/** Every statement sent through the pool while `body` runs. */
async function statementsDuring(body: () => Promise<unknown>) {
  const pool = getPool();
  const original = pool.query;
  const statements: string[] = [];
  pool.query = ((...args: Parameters<typeof original>) => {
    const [first] = args as unknown[];
    statements.push(
      typeof first === "string" ? first : (first as { text: string }).text,
    );
    return original.apply(pool, args);
  }) as typeof pool.query;
  try {
    await body();
  } finally {
    pool.query = original;
  }
  return statements;
}

/** A read of the whole ledger: nothing else on these screens joins payers. */
const ledgerReads = (statements: string[]) =>
  statements.filter((sql) => sql.includes('"expense_payers"')).length;

const membershipReads = (statements: string[]) =>
  statements.filter((sql) => sql.includes('"group_members"')).length;

async function addTestMember(groupId: string, name: string) {
  const actor = await createTestUser({ name });
  const [participant] = await getDb()
    .insert(participants)
    .values({
      groupId,
      displayName: name,
      email: actor.email,
      userId: actor.userId,
    })
    .returning({ id: participants.id });
  await getDb().insert(groupMembers).values({
    groupId,
    userId: actor.userId,
    participantId: participant.id,
    role: "member",
  });
  return { actor, participantId: participant.id };
}

/** The owner pays, and the cost is split with `debtorId`. */
async function spend(group: TestGroup, debtorId: string, amount: string) {
  await createExpense(group.access, {
    description: "Dinner",
    notes: "",
    category: "",
    amount,
    currency: "EUR",
    exchangeRate: "",
    payers: [{ participantId: group.ownerParticipantId, amount }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: debtorId },
    ],
    expenseDate: isoToday(),
  });
}

function positionOf(balances: GroupBalances, participantId: string): bigint {
  return (
    balances.currencies
      .find((entry) => entry.currency === "EUR")
      ?.balances.find((balance) => balance.participantId === participantId)
      ?.amount ?? 0n
  );
}

let owner: UserActor;
let group: TestGroup;
let debtor: { actor: UserActor; participantId: string };

beforeEach(async () => {
  owner = await createTestUser({ name: "Seb" });
  group = await createTestGroup(owner, { name: "Portugal, March" });
  debtor = await addTestMember(group.groupId, "Jonas");
  await spend(group, debtor.participantId, "3000");
  cookieActor.value = owner;
});

describe("the ledger, read once per render", () => {
  it("serves the group overview and its reminder list from one read", async () => {
    const inOneRender = await statementsDuring(() =>
      render.inRender(() =>
        Promise.all([
          loadGroupOverview(group.access),
          listRemindRecipients(group.access),
        ]),
      ),
    );
    // The same two calls with no render around them: the counter's control,
    // and what an action or a route handler still pays.
    const outsideARender = await statementsDuring(() =>
      Promise.all([
        loadGroupOverview(group.access),
        listRemindRecipients(group.access),
      ]),
    );

    expect(ledgerReads(inOneRender)).toBe(1);
    expect(ledgerReads(outsideARender)).toBe(2);
  });

  it("serves the settle-up plan and its reminder list from one read", async () => {
    const statements = await statementsDuring(() =>
      render.inRender(() =>
        Promise.all([
          loadSettleUp(group.access),
          listRemindRecipients(group.access),
        ]),
      ),
    );

    expect(ledgerReads(statements)).toBe(1);
  });

  it("serves the join screen's summary and its claimable names from one read", async () => {
    await addTestParticipant(group.groupId, "Padi");

    const statements = await statementsDuring(() =>
      render.inRender(() =>
        Promise.all([
          loadJoinSummary(group.groupId),
          listClaimableMembers(group.groupId),
        ]),
      ),
    );

    expect(ledgerReads(statements)).toBe(1);
  });

  it("still gives each caller the figures it asked for", async () => {
    // `contributionsFor` is derived from the shared rows, not part of the key,
    // so two callers asking different questions must not get one answer.
    const [mine, plain] = await render.inRender(() =>
      Promise.all([
        loadGroupBalances(group.access, {
          contributionsFor: group.ownerParticipantId,
        }),
        loadGroupBalances(group.access),
      ]),
    );

    expect(mine.contributions.get("EUR")).toEqual({
      paid: 3000n,
      share: 1500n,
    });
    expect(plain.contributions.size).toBe(0);
  });

  it("never hands a transaction the pool's memo", async () => {
    await render.inRender(async () => {
      const seen = await loadGroupBalances(group.access);

      await getDb().transaction(async (tx) => {
        await tx
          .update(expenses)
          .set({ deletedAt: new Date() })
          .where(eq(expenses.groupId, group.groupId));

        const inside = await loadGroupBalances(group.access, { db: tx });
        expect(positionOf(inside, debtor.participantId)).toBe(0n);
      });

      expect(positionOf(seen, debtor.participantId)).toBe(-1500n);
    });
  });
});

describe("the ledger after a Server Action", () => {
  it("shows the render after an action the expense the action added", async () => {
    const before = await render.inRender(() => loadGroupBalances(group.access));

    // The action: outside any render, exactly where Next.js runs one.
    await spend(group, debtor.participantId, "1000");

    const after = await render.inRender(() => loadGroupBalances(group.access));

    expect(positionOf(before, debtor.participantId)).toBe(-1500n);
    expect(positionOf(after, debtor.participantId)).toBe(-2000n);
  });

  it("reads afresh inside the action itself, where there is no render", async () => {
    const before = await loadGroupBalances(group.access);
    await spend(group, debtor.participantId, "1000");
    const after = await loadGroupBalances(group.access);

    expect(positionOf(before, debtor.participantId)).toBe(-1500n);
    expect(positionOf(after, debtor.participantId)).toBe(-2000n);
  });
});

describe("group authorization, asked once per render", () => {
  it("costs the page no second membership query after the layout's", async () => {
    const statements = await statementsDuring(() =>
      render.inRender(async () => {
        // The group layout asks, and then the page under it asks again.
        await requireGroupAccess(group.groupId);
        await requireGroupAccess(group.groupId);
      }),
    );

    expect(membershipReads(statements)).toBe(1);
  });

  it("costs a guest's page no second read of the group either", async () => {
    cookieActor.value = {
      kind: "guest",
      groupId: group.groupId,
      participantId: debtor.participantId,
      displayName: "Jonas",
      sessionId: randomUUID(),
    };

    const statements = await statementsDuring(() =>
      render.inRender(async () => {
        await requireGroupAccess(group.groupId);
        await requireGroupAccess(group.groupId);
      }),
    );

    expect(
      statements.filter((sql) => sql.includes('from "groups"')).length,
    ).toBe(1);
  });

  it("never lets the layout's read-only answer stand in for a write", async () => {
    await setGroupArchived(group.access, true);

    await render.inRender(async () => {
      // Reading an archived group is allowed; changing it is not, and the
      // flag is part of what is remembered.
      await expect(requireGroupAccess(group.groupId)).resolves.toMatchObject({
        groupId: group.groupId,
      });
      await expect(
        requireGroupAccess(group.groupId, { requireActive: true }),
      ).rejects.toBeInstanceOf(AuthorizationError);
    });
  });

  it("answers each render for its own actor", async () => {
    // Two requests from two people, one after the other in one process: the
    // memo belongs to the render, so the second is not handed the first's
    // access.
    await render.inRender(() => requireGroupAccess(group.groupId));

    cookieActor.value = await createTestUser({ name: "Mallory" });

    await expect(
      render.inRender(() => requireGroupAccess(group.groupId)),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });
});

describe("group authorization after a Server Action", () => {
  beforeEach(async () => {
    // Nobody is removed while they still owe: the debtor pays back their half
    // of the dinner first, so what is under test is the access check after
    // the removal and not the open-balance refusal before it.
    await createSettlement(group.access, {
      fromParticipantId: debtor.participantId,
      toParticipantId: group.ownerParticipantId,
      amount: "1500",
      currency: "EUR",
      exchangeRate: "",
      settledOn: isoToday(),
      notes: "",
    });
    cookieActor.value = debtor.actor;
  });

  it("refuses, in the render after it, the member an action removed", async () => {
    await render.inRender(() => requireGroupAccess(group.groupId));

    // The action: outside any render.
    await removeParticipant(group.access, debtor.participantId);

    await expect(
      render.inRender(() => requireGroupAccess(group.groupId)),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("refuses them inside the action too, where nothing is remembered", async () => {
    await requireGroupAccess(group.groupId);
    await removeParticipant(group.access, debtor.participantId);

    await expect(requireGroupAccess(group.groupId)).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});
