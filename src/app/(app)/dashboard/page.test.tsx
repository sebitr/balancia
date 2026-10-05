import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../messages/en.json";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { money } from "@/modules/currencies/money";
import type { GroupSummary } from "@/modules/groups/service";
import type {
  GroupPosition,
  HomeBuckets,
  HomeOverview,
} from "@/modules/balances/overview";

/**
 * The home screen's sections, and which group lands under which.
 *
 * The page is a Server Component, called here and its output mounted. The
 * position widget stands in as one line saying what it was told, because what
 * it draws has a suite of its own; what is pinned here is the page's half —
 * the labels on the sections, and the split it makes between a group that is
 * square because it was paid back and one that is square because nothing has
 * happened in it yet.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "dashboard") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
  }) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>
      {children}
    </a>
  ),
}));

const { loadHomeOverview } = vi.hoisted(() => ({
  loadHomeOverview: vi.fn<() => Promise<HomeOverview>>(),
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => ({ userId: "u1", name: "Ada" }),
}));
vi.mock("@/modules/auth/service", () => ({
  getUserPreferredCurrency: async () => null,
}));
vi.mock("@/modules/balances/overview", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/balances/overview")>()),
  loadHomeOverview,
}));

// Everything around the list, each reduced to what this suite asks of it.
vi.mock("@/components/groups/create-group-launcher", () => ({
  CreateGroupLauncher: () => null,
}));
vi.mock("@/components/pwa/install-prompt", () => ({
  InstallPrompt: () => null,
}));
vi.mock("@/components/dashboard/name-nudge", () => ({
  NameNudge: () => null,
}));
vi.mock("@/components/dashboard/position-widget", () => ({
  PositionWidget: ({ unstarted }: { unstarted: { count: number } | null }) => (
    <p>{unstarted ? `Widget: unstarted ${unstarted.count}` : "Widget"}</p>
  ),
}));

const { default: DashboardPage } = await import("./page");

const NOW = new Date("2026-10-06T12:00:00Z");

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
    role: "owner",
    participantCount: 3,
    participantId: `p-${id}`,
    lastActivityAt: NOW,
    memberNames: ["Ada", "Sam", "Marta"],
  };
}

function position(
  id: string,
  name: string,
  minorUnits: bigint | null,
  hasEntries = true,
): GroupPosition {
  const amounts = minorUnits === null ? [] : [money(minorUnits, "EUR")];
  return {
    group: group(id, name),
    amounts,
    net: minorUnits === null ? null : money(minorUnits, "EUR"),
    owedTo: null,
    hasEntries,
  };
}

function overview(buckets: Partial<HomeBuckets>): HomeOverview {
  const full: HomeBuckets = {
    needsYou: [],
    youAreOwed: [],
    settled: [],
    archived: [],
    ...buckets,
  };
  return {
    displayCurrency: null,
    netPosition: null,
    currencyTotals: [],
    ratesAsOf: null,
    converted: false,
    buckets: full,
    groupCount: Object.values(full).flat().length,
    lastCleared: null,
  };
}

async function renderHome() {
  const page = (await DashboardPage()) as ReactElement;
  return renderWithIntl(page);
}

const sectionOf = (heading: string) =>
  screen.getByRole("heading", { name: heading }).closest("section")!;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the home screen's sections", () => {
  /**
   * Its sibling says where the reader stands, and so does this one now. Every
   * group filed here holds a debt of the reader's, so the label is true of
   * each row — the mixed-currency one included.
   */
  it("calls the groups the reader owes in 'You owe', beside 'You're owed'", async () => {
    loadHomeOverview.mockResolvedValue(
      overview({
        needsYou: [position("g1", "Flatshare", -96084n)],
        youAreOwed: [position("g2", "Lisbon, March", 888n)],
      }),
    );

    await renderHome();

    expect(
      within(sectionOf("You owe")).getByRole("link", { name: /Flatshare/ }),
    ).toBeInTheDocument();
    expect(
      within(sectionOf("You're owed")).getByRole("link", {
        name: /Lisbon, March/,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Needs you")).not.toBeInTheDocument();
  });

  it("keeps a group with nothing recorded out of Settled up", async () => {
    loadHomeOverview.mockResolvedValue(
      overview({
        settled: [
          position("g1", "Lisbon trip", null, false),
          position("g2", "Chalet", null, true),
        ],
      }),
    );

    await renderHome();

    expect(
      within(sectionOf("No expenses yet")).getByRole("link", {
        name: /Lisbon trip/,
      }),
    ).toBeInTheDocument();
    const settled = sectionOf("Settled up · 1");
    expect(
      within(settled).getByRole("link", { name: /Chalet/ }),
    ).toBeInTheDocument();
    expect(
      within(settled).queryByRole("link", { name: /Lisbon trip/ }),
    ).not.toBeInTheDocument();
    // There is a settled group, so the figure above is still a result.
    expect(screen.getByText("Widget")).toBeInTheDocument();
  });

  it("tells the figure above when no group has started at all", async () => {
    loadHomeOverview.mockResolvedValue(
      overview({ settled: [position("g1", "Lisbon trip", null, false)] }),
    );

    await renderHome();

    expect(screen.getByText("Widget: unstarted 1")).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /Settled up/ }),
    ).not.toBeInTheDocument();
  });
});
