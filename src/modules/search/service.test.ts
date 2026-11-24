import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/client";
import type { GuestActor, UserActor } from "@/lib/security/authorization";
import type { GroupBalances } from "@/modules/balances/service";
import type { GroupSummary } from "@/modules/groups/service";

/**
 * What the command palette reads, counted.
 *
 * It asks on opening and on every pause in typing, and it used to compute
 * where the reader stands in every group each time — the whole home overview
 * — to filter a list of names. The membership list is one cheap read; only
 * the groups whose name matches have their balances read, and only when that
 * gives the answer the sidebar gives. Who may be found, and in which groups,
 * is `tests/integration/command-palette.test.ts`; this is what it costs.
 */

const reads = vi.hoisted(() => ({
  listGroupsForUser: vi.fn(),
  loadBalancesForGroups: vi.fn(),
  getUserPreferredCurrency: vi.fn(),
  loadTransactionPage: vi.fn(),
}));

vi.mock("@/modules/groups/service", () => ({
  listGroupsForUser: reads.listGroupsForUser,
}));
vi.mock("@/modules/balances/service", () => ({
  loadBalancesForGroups: reads.loadBalancesForGroups,
  loadGroupBalances: vi.fn(),
}));
vi.mock("@/modules/auth/service", () => ({
  getUserPreferredCurrency: reads.getUserPreferredCurrency,
}));
vi.mock("@/modules/expenses/transactions", () => ({
  loadTransactionPage: reads.loadTransactionPage,
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("The test hands the service a database of its own");
  },
}));

const { searchPalette } = await import("./service");

const READER: UserActor = {
  kind: "user",
  userId: "user-1",
  email: "ada@example.com",
  name: "Ada",
};

function group(
  id: string,
  name: string,
  overrides: Partial<GroupSummary> = {},
): GroupSummary {
  return {
    id,
    name,
    description: null,
    icon: null,
    iconColor: null,
    currencyMode: "separate",
    baseCurrency: null,
    timezone: "UTC",
    archivedAt: null,
    role: "member",
    participantCount: 2,
    participantId: `${id}-me`,
    lastActivityAt: new Date("2026-11-01T12:00:00Z"),
    memberNames: ["Ada", "Ben"],
    memberIds: [],
    ...overrides,
  };
}

const LISBON = group("lisbon", "Lisbon trip");
const FLAT = group("flat", "Flat");
const BOOK_CLUB = group("book", "Book club");
const OLD_LISBON = group("old-lisbon", "Lisbon 2019", {
  archivedAt: new Date("2020-01-01T00:00:00Z"),
});

/** The reader is owed €12 in every group asked about. */
function owed(summary: GroupSummary): GroupBalances {
  return {
    currencies: [
      {
        currency: "EUR",
        balances: [
          { participantId: summary.participantId, amount: 1200n },
          { participantId: `${summary.id}-other`, amount: -1200n },
        ],
        totalOutstanding: 1200n,
      },
    ],
    suggestionsByCurrency: new Map(),
    totalSpend: new Map(),
    participantNames: new Map(),
  } as unknown as GroupBalances;
}

/** A query builder that answers the people search with nobody. */
function emptyDb(): Database {
  const chain: Record<string, unknown> = {};
  for (const step of ["select", "from", "where", "orderBy"]) {
    chain[step] = () => chain;
  }
  chain.limit = async () => [];
  return chain as unknown as Database;
}

/** The ids of the groups whose balances were read, call by call. */
function balancesReadFor(): string[][] {
  return reads.loadBalancesForGroups.mock.calls.map((call) =>
    (call[0] as readonly GroupSummary[]).map((one) => one.id),
  );
}

function search(query: string, actor: UserActor | GuestActor = READER) {
  return searchPalette(actor, null, query, { db: emptyDb() });
}

beforeEach(() => {
  reads.listGroupsForUser.mockResolvedValue([
    LISBON,
    FLAT,
    BOOK_CLUB,
    OLD_LISBON,
  ]);
  reads.getUserPreferredCurrency.mockResolvedValue("EUR");
  reads.loadBalancesForGroups.mockImplementation(
    async (groups: readonly GroupSummary[]) =>
      new Map(groups.map((one) => [one.id, owed(one)])),
  );
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("searchPalette's reads", () => {
  it("reads no balances for a search that names no group", async () => {
    const results = await search("dinner");

    expect(results.groups).toEqual([]);
    expect(reads.listGroupsForUser).toHaveBeenCalledTimes(1);
    expect(reads.loadBalancesForGroups).not.toHaveBeenCalled();
    expect(reads.getUserPreferredCurrency).not.toHaveBeenCalled();
  });

  it("reads the balances of the groups it names and no others", async () => {
    const results = await search("lisbon");

    expect(balancesReadFor()).toEqual([["lisbon"]]);
    expect(results.groups.map((one) => one.id)).toEqual(["lisbon"]);
    // The row the sidebar draws: where the reader stands, in the group's
    // own currency.
    expect(results.groups[0]).toMatchObject({
      direction: "owed",
      amounts: [{ minorUnits: "1200", currency: "EUR" }],
    });
  });

  it("reads every group when the display currency depends on all of them", async () => {
    // With no stated preference the net is converted into whichever
    // currency the reader's balances use most, across every group; a few
    // groups cannot say which, so the whole list is read as before.
    reads.getUserPreferredCurrency.mockResolvedValue(null);

    const results = await search("lisbon");

    expect(balancesReadFor()).toEqual([["lisbon", "flat", "book"]]);
    expect(results.groups.map((one) => one.id)).toEqual(["lisbon"]);
  });

  it("reads every open group's balances once on opening, never an archived one's", async () => {
    const results = await search("");

    expect(balancesReadFor()).toEqual([["lisbon", "flat", "book"]]);
    expect(results.groups.map((one) => one.id)).not.toContain("old-lisbon");
  });

  it("lists no groups for a guest and reads nobody's", async () => {
    const guest: GuestActor = {
      kind: "guest",
      groupId: "lisbon",
      participantId: "lisbon-guest",
      displayName: "Cleo",
      sessionId: "session",
    };

    const results = await search("lisbon", guest);

    expect(results.groups).toEqual([]);
    expect(reads.listGroupsForUser).not.toHaveBeenCalled();
    expect(reads.loadBalancesForGroups).not.toHaveBeenCalled();
  });
});
