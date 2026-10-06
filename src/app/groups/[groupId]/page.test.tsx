import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../messages/en.json";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import type { ActivityEntry } from "@/modules/activity/service";
import type { GroupOverview } from "@/modules/groups/overview";
import type { GroupAccess } from "@/lib/security/authorization";

/**
 * The overview's way to the group's history.
 *
 * Every dialog that deletes something promises it can be restored "later from
 * Activity", and for a long time nothing on any screen led there. "Since your
 * last visit" links there now, but that block renders only when something is
 * new — and somebody who has just deleted an entry has seen the deletion. So
 * what is pinned here is the row that does not depend on news: present on
 * every group with money in it, for a guest as for the owner, and on an empty
 * group exactly when that group was emptied by a deletion.
 *
 * The page is a Server Component, called here and its output mounted. Every
 * card on it but the row is a stand-in: they have suites of their own, and
 * this one is about what sits at the foot. "Since your last visit" stands in
 * as nothing at all, which is what it renders when nothing is new — see
 * `since-last-opened.test.tsx`.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "group") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

// Marks the group opened once the render is done; nothing to do in jsdom.
vi.mock("next/server", () => ({ after: () => {} }));

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

const { requireGroupAccess, listGroupActivity, loadGroupOverview } = vi.hoisted(
  () => ({
    requireGroupAccess: vi.fn<() => Promise<GroupAccess>>(),
    listGroupActivity: vi.fn<() => Promise<ActivityEntry[]>>(),
    loadGroupOverview: vi.fn<() => Promise<GroupOverview>>(),
  }),
);

vi.mock("@/lib/actions", () => ({ requireGroupAccess }));
vi.mock("@/lib/security/join-link", () => ({
  describeJoinLink: async () => null,
}));
vi.mock("@/modules/activity/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/activity/service")>()),
  listGroupActivity,
}));
vi.mock("@/modules/groups/overview", () => ({
  loadGroupOverview,
  markGroupOpened: async () => {},
  isMultiCurrency: (currencies: readonly unknown[]) => currencies.length > 1,
  mainCurrencyOf: () => null,
}));
vi.mock("@/modules/groups/service", () => ({
  listParticipants: async () => [{ id: "p-ada", displayName: "Ada" }],
}));
vi.mock("@/modules/guests/service", () => ({
  countContributions: async () => 0,
}));
vi.mock("@/modules/reminders/service", () => ({
  listRemindRecipients: async () => [],
}));

// The cards around the row, each reduced to something that says it is there.
vi.mock("@/components/activity/since-last-opened", () => ({
  SinceLastOpened: () => null,
}));
vi.mock("@/components/entries/draft-row", () => ({ DraftRow: () => null }));
vi.mock("@/components/groups/position-hero", () => ({
  PositionHero: () => <p>Position</p>,
}));
vi.mock("@/components/groups/position-card", () => ({
  PositionCard: () => <p>Position</p>,
}));
vi.mock("@/components/groups/balance-list", () => ({
  BalanceList: () => null,
}));
vi.mock("@/components/groups/currency-balances", () => ({
  CurrencyBalances: () => null,
}));
vi.mock("@/components/groups/settlement-list", () => ({
  SettlementList: () => null,
}));
vi.mock("@/components/groups/spending-card", () => ({
  SpendingCard: () => <p>Spending card</p>,
}));
vi.mock("@/components/groups/group-empty-state", () => ({
  GroupEmptyState: () => <p>Start here</p>,
}));
vi.mock("@/components/guests/guest-account-widget", () => ({
  GuestAccountWidget: () => null,
}));

const { default: GroupOverviewPage } = await import("./page");

const NO_PERMISSIONS = {
  manageGroupSettings: false,
  manageInvitations: false,
  importData: false,
  exportData: false,
  editAnyExpense: false,
  addSettlement: false,
  manageRecurring: false,
  removeParticipants: false,
};

function access(overrides: Partial<GroupAccess> = {}): GroupAccess {
  return {
    groupId: "g1",
    actor: { kind: "user", userId: "u1", name: "Ada" },
    participantId: "p-ada",
    role: "member",
    permissions: NO_PERMISSIONS,
    group: {
      id: "g1",
      name: "Lisbon, March",
      currencyMode: "separate",
      baseCurrency: "EUR",
      timezone: "Europe/Lisbon",
      archivedAt: null,
    },
    ...overrides,
  } as unknown as GroupAccess;
}

function overview(expenseCount: number): GroupOverview {
  return {
    participantCount: 2,
    expenseCount,
    span: null,
    positions: [],
    spendingPeriods: [],
    currencies: [],
    rows: [],
    suggestions: [],
    // Opened after everything below happened: nothing is new.
    lastOpenedAt: new Date("2026-09-30T00:00:00Z"),
  };
}

function event(
  fields: Pick<ActivityEntry, "id" | "action" | "entityType"> &
    Partial<ActivityEntry>,
): ActivityEntry {
  return {
    entityId: null,
    metadata: null,
    actorLabel: "Ada",
    actorType: "user",
    actorParticipantId: "p-ada",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...fields,
  };
}

const CREATED = event({
  id: "a1",
  action: "group.created",
  entityType: "group",
  entityId: "g1",
});
const BOB_ADDED = event({
  id: "a2",
  action: "participant.created",
  entityType: "participant",
  entityId: "p-bob",
  metadata: { displayName: "Bob" },
});
const DINNER_ADDED = event({
  id: "a3",
  action: "expense.created",
  entityType: "expense",
  entityId: "e1",
  metadata: { description: "Dinner" },
});
const DINNER_DELETED = event({
  id: "a4",
  action: "expense.deleted",
  entityType: "expense",
  entityId: "e1",
  metadata: { description: "Dinner", amount: "3000", currency: "EUR" },
});

async function renderOverview() {
  const page = (await GroupOverviewPage({
    params: Promise.resolve({ groupId: "g1" }),
  } as PageProps<"/groups/[groupId]">)) as ReactElement;
  return renderWithIntl(page);
}

const activityRow = () =>
  screen.queryByRole("link", {
    name: "Activity · Every change, deletions included",
  });

beforeEach(() => {
  vi.clearAllMocks();
  requireGroupAccess.mockResolvedValue(access());
  listGroupActivity.mockResolvedValue([DINNER_ADDED, BOB_ADDED, CREATED]);
  loadGroupOverview.mockResolvedValue(overview(1));
});

describe("the overview's row to the group's history", () => {
  it("is there when nothing is new, and opens the Activity screen", async () => {
    await renderOverview();

    const row = activityRow();
    expect(row).toHaveAttribute("href", "/groups/g1/activity");
    // Pushed, like every screen the overview hands detail to.
    expect(row).toHaveAttribute("data-transition", "push");
  });

  it("sits at the foot, under the spending card", async () => {
    await renderOverview();

    const spending = screen.getByText("Spending card");
    expect(
      spending.compareDocumentPosition(activityRow()!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("is offered to a guest too, who may open Activity like anyone in the group", async () => {
    requireGroupAccess.mockResolvedValue(
      access({
        role: "guest",
        participantId: null,
        actor: {
          kind: "guest",
          displayName: "Visitor",
        } as unknown as GroupAccess["actor"],
      }),
    );

    await renderOverview();

    expect(activityRow()).toHaveAttribute("href", "/groups/g1/activity");
  });

  it("stays off a brand-new group, whose whole history is being set up", async () => {
    loadGroupOverview.mockResolvedValue(overview(0));
    listGroupActivity.mockResolvedValue([BOB_ADDED, CREATED]);

    await renderOverview();

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(activityRow()).toBeNull();
  });

  it("comes back on a group emptied by a deletion, which Activity can undo", async () => {
    loadGroupOverview.mockResolvedValue(overview(0));
    listGroupActivity.mockResolvedValue([
      DINNER_DELETED,
      DINNER_ADDED,
      BOB_ADDED,
      CREATED,
    ]);

    await renderOverview();

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(activityRow()).toHaveAttribute("href", "/groups/g1/activity");
  });
});

/**
 * The two columns a desktop window gets from `lg` up.
 *
 * The grid only places them; the document decides the order a screen reader
 * and a keyboard take, and a phone shows. So that order is pinned here: the
 * money first, then the context — the same order the single column has
 * always read in.
 */
describe("the overview's columns", () => {
  const column = (element: HTMLElement, slot: string) =>
    element.closest(`[data-slot="${slot}"]`);

  it("put where you stand on the left and what changed on the right", async () => {
    await renderOverview();

    const primary = column(screen.getByText("Position"), "overview-primary");
    const secondary = column(
      screen.getByText("Spending card"),
      "overview-secondary",
    );
    expect(primary).not.toBeNull();
    expect(secondary).toContainElement(activityRow());
    // Siblings in one wide layout, the money first in the document.
    expect(primary?.parentElement).toHaveAttribute("data-layout", "wide");
    expect(secondary?.parentElement).toBe(primary?.parentElement);
    expect(
      primary!.compareDocumentPosition(secondary!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leave an empty group in the one column it has always had", async () => {
    loadGroupOverview.mockResolvedValue(overview(0));

    const { container } = await renderOverview();

    expect(screen.getByText("Start here")).toBeInTheDocument();
    expect(container.querySelector('[data-layout="wide"]')).toBeNull();
  });
});
