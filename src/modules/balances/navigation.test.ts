import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GroupSummary } from "@/modules/groups/service";
import type { GroupBalances } from "./service";

/**
 * Home and the sidebar beside it read every group's balances once per render
 * between them, not once each.
 *
 * Both are in the same render — the page and the shell around it — and both
 * want the same overview: Home to draw it, the sidebar to list its groups in
 * Home's order. What is counted here is the batched read every group's
 * balances come from, which is the whole cost of the overview.
 *
 * The memo is React's server `cache`, swapped in for the client build's
 * pass-through (see `tests/helpers/server-render.ts`), so a test that passed
 * with the memo missing is not possible.
 */

const render = await vi.hoisted(async () =>
  (await import("../../../tests/helpers/server-render")).serverRender(),
);

vi.mock("react", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react")>()),
  cache: render.cache,
}));

const reads = vi.hoisted(() => ({
  listGroupsForUser: vi.fn(),
  loadBalancesForGroups: vi.fn(),
  getUserPreferredCurrency: vi.fn(),
}));

vi.mock("@/modules/groups/service", () => ({
  listGroupsForUser: reads.listGroupsForUser,
}));
vi.mock("./service", () => ({
  loadBalancesForGroups: reads.loadBalancesForGroups,
  loadGroupBalances: vi.fn(),
}));
vi.mock("@/modules/auth/service", () => ({
  getUserPreferredCurrency: reads.getUserPreferredCurrency,
}));
vi.mock("@/lib/db/client", () => ({
  getDb: () => {
    throw new Error("No query beyond the mocked reads is expected here");
  },
}));

const { loadHomeOverviewOnce } = await import("./overview");
const { loadNavigationGroups } = await import("./navigation");
const { todayIso } = await import("@/modules/currencies/provider");

const USER = "user-1";

function group(id: string, name: string): GroupSummary {
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
    memberHues: [],
  };
}

/** The reader is owed `amount` cents of euros in the group. */
function owed(summary: GroupSummary, amount: bigint): GroupBalances {
  return {
    currencies: [
      {
        currency: "EUR",
        balances: [
          { participantId: summary.participantId, amount },
          { participantId: `${summary.id}-other`, amount: -amount },
        ],
        totalOutstanding: amount,
      },
    ],
    suggestionsByCurrency: new Map(),
    totalSpend: new Map(),
    participantNames: new Map(),
    contributions: new Map(),
    revenues: new Map(),
    settlementsFor: new Map(),
  } as unknown as GroupBalances;
}

const LISBON = group("lisbon", "Lisbon");
const FLAT = group("flat", "Flat");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-11-24T10:00:00Z") });
  reads.listGroupsForUser.mockResolvedValue([LISBON, FLAT]);
  reads.getUserPreferredCurrency.mockResolvedValue("EUR");
  reads.loadBalancesForGroups.mockImplementation(
    async (groups: readonly GroupSummary[]) =>
      new Map(groups.map((one) => [one.id, owed(one, 1200n)])),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

/** What Home asks for, as `dashboard/page.tsx` asks for it. */
function asHome() {
  const now = new Date();
  return loadHomeOverviewOnce(USER, "EUR", todayIso(now));
}

describe("Home and the sidebar in one render", () => {
  it("read every group's balances once between them", async () => {
    const [overview, sidebar] = await render.inRender(() =>
      Promise.all([asHome(), loadNavigationGroups(USER)]),
    );

    expect(reads.loadBalancesForGroups).toHaveBeenCalledTimes(1);
    expect(reads.listGroupsForUser).toHaveBeenCalledTimes(1);
    // The same overview, so the same groups in the same order.
    expect(sidebar.map((one) => one.id)).toEqual(
      overview.buckets.youAreOwed.map((position) => position.group.id),
    );
  });

  it("read once whichever of the two asks first", async () => {
    await render.inRender(async () => {
      await loadNavigationGroups(USER);
      await asHome();
    });

    expect(reads.loadBalancesForGroups).toHaveBeenCalledTimes(1);
  });

  it("read again on the next render, which starts from nothing", async () => {
    await render.inRender(() => asHome());
    await render.inRender(() => asHome());

    expect(reads.loadBalancesForGroups).toHaveBeenCalledTimes(2);
  });

  it("read for each caller outside a render, as a Server Action does", async () => {
    await asHome();
    await asHome();

    expect(reads.loadBalancesForGroups).toHaveBeenCalledTimes(2);
  });

  it("do not share an overview across a change of preference", async () => {
    await render.inRender(async () => {
      await loadHomeOverviewOnce(USER, "EUR", "2026-11-24");
      await loadHomeOverviewOnce(USER, "CHF", "2026-11-24");
    });

    expect(reads.loadBalancesForGroups).toHaveBeenCalledTimes(2);
  });
});
