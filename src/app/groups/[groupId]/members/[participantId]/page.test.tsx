import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../../../messages/en.json";
import { renderWithIntl } from "../../../../../../tests/helpers/intl";
import { settleIntentPath } from "@/components/entries/settle-intent";
import type { GroupAccess } from "@/lib/security/authorization";
import type { GroupBalances } from "@/modules/balances/service";
import type { RepaymentSuggestion } from "@/modules/balances/engine";
import type { RemindRecipient } from "@/modules/reminders/types";

/**
 * A person's page, and what it lets the reader do about what is between them.
 *
 * It used to open on "Between you two · CHF 960.84 · You owe Marta" and offer
 * nothing at all to do about it. The settle screen's own buttons for the same
 * pair now sit under that sentence — "I paid Marta" one way, "I was paid back"
 * and "Remind" the other — and nothing at all when there is nothing to settle
 * or nobody to settle with. Under the position, a row opens the entries that
 * make the number up.
 *
 * The page is a Server Component, called here and its output mounted. The
 * balances are stood in for, so each case says in a line who owes whom; the
 * statistics block below has a suite of its own and is left out.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "memberStats" | "common") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

const {
  requireGroupAccess,
  loadGroupBalances,
  listRemindRecipients,
  buildPayoutHints,
} = vi.hoisted(() => ({
  requireGroupAccess: vi.fn<() => Promise<GroupAccess>>(),
  loadGroupBalances: vi.fn<() => Promise<GroupBalances>>(),
  listRemindRecipients: vi.fn<() => Promise<RemindRecipient[]>>(),
  buildPayoutHints: vi.fn(async () => []),
}));

vi.mock("@/lib/actions", () => ({ requireGroupAccess }));
vi.mock("@/i18n/preferences", () => ({
  getDateFormatter: async () => ({ at: () => "2 Feb 2026" }),
}));
vi.mock("@/modules/balances/service", () => ({ loadGroupBalances }));
vi.mock("@/modules/reminders/service", () => ({ listRemindRecipients }));
vi.mock("@/modules/payouts/hints", () => ({ buildPayoutHints }));
vi.mock("@/modules/groups/member-stats-service", () => ({
  loadMemberStats: async () => ({
    currencies: ["CHF"],
    firstEntry: null,
    ranges: [],
    activity: { longestRun: 0, currentRun: 0, days: [] },
    records: [],
  }),
}));
vi.mock("@/modules/groups/service", () => ({
  listParticipants: async () =>
    ["Seb", "Marta", "Jonas"].map((name) => ({
      id: name.toLowerCase(),
      displayName: name,
      role: name === "Seb" ? "owner" : "member",
      createdAt: new Date("2026-02-02T00:00:00Z"),
    })),
}));
vi.mock("@/components/members/member-statistics", () => ({
  MemberStatistics: () => <p>Statistics block</p>,
}));

const { default: MemberStatsPage } = await import("./page");

function access(overrides: Partial<GroupAccess> = {}): GroupAccess {
  return {
    groupId: "g1",
    actor: { kind: "user", userId: "u1", name: "Seb" },
    participantId: "seb",
    role: "owner",
    permissions: { addSettlement: true },
    group: {
      id: "g1",
      name: "Verbier, February",
      currencyMode: "separate",
      baseCurrency: "CHF",
      timezone: "Europe/Zurich",
      archivedAt: null,
    },
    ...overrides,
  } as unknown as GroupAccess;
}

const NAMES = new Map([
  ["seb", "Seb"],
  ["marta", "Marta"],
  ["jonas", "Jonas"],
]);

/** The group's simplified debts in CHF, and the balances they clear. */
function balances(
  debts: readonly (readonly [from: string, to: string, amount: bigint])[],
): GroupBalances {
  const suggestions: RepaymentSuggestion[] = debts.map(
    ([fromParticipantId, toParticipantId, amount]) => ({
      fromParticipantId,
      toParticipantId,
      amount,
      currency: "CHF",
    }),
  );
  const net = new Map<string, bigint>();
  for (const [from, to, amount] of debts) {
    net.set(from, (net.get(from) ?? 0n) - amount);
    net.set(to, (net.get(to) ?? 0n) + amount);
  }
  return {
    currencies: [
      {
        currency: "CHF",
        balances: [...NAMES.keys()].map((participantId) => ({
          participantId,
          amount: net.get(participantId) ?? 0n,
        })),
        totalOutstanding: 0n,
      },
    ],
    suggestionsByCurrency: new Map([["CHF", suggestions]]),
    participantNames: NAMES,
  } as unknown as GroupBalances;
}

const MARTA_IS_OWED = balances([
  ["seb", "marta", 96084n],
  ["jonas", "marta", 101801n],
]);
const MARTA_OWES_SEB = balances([["marta", "seb", 41250n]]);
const NOTHING_BETWEEN_THEM = balances([["jonas", "marta", 101801n]]);

function recipient(): RemindRecipient {
  return {
    participantId: "marta",
    name: "Marta",
    debts: [{ amount: "41250", currency: "CHF" }],
    channel: "share",
    payWith: [],
    lastRemindedAt: null,
    locked: false,
    muted: false,
    link: { kind: "group" },
  };
}

async function open(participantId: string) {
  const page = await MemberStatsPage({
    params: Promise.resolve({ groupId: "g1", participantId }),
  } as never);
  return renderWithIntl(page);
}

beforeEach(() => {
  requireGroupAccess.mockResolvedValue(access());
  loadGroupBalances.mockResolvedValue(MARTA_IS_OWED);
  listRemindRecipients.mockResolvedValue([recipient()]);
  buildPayoutHints.mockClear();
  listRemindRecipients.mockClear();
});

describe("the person's page", () => {
  describe("when the reader owes them", () => {
    it("offers to record that the reader paid them back", async () => {
      await open("marta");

      expect(screen.getByText("You owe Marta")).toBeInTheDocument();
      const link = screen.getByRole("link", {
        name: "Record Seb's repayment to Marta",
      });
      expect(link).toHaveTextContent("I paid Marta");
      expect(link).toHaveAttribute(
        "href",
        settleIntentPath("g1", {
          fromParticipantId: "seb",
          toParticipantId: "marta",
          currency: "CHF",
        }),
      );
      expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
    });

    it("asks how to pay this person and nobody else", async () => {
      await open("marta");

      expect(listRemindRecipients).not.toHaveBeenCalled();
      expect(buildPayoutHints).toHaveBeenCalledTimes(1);
      const [, , view] = buildPayoutHints.mock.calls[0] as unknown as [
        string,
        string,
        { currencies: { yours: { toParticipantId: string }[] }[] },
      ];
      // Jonas also owes Marta, and the reader owes nobody but her: one debt.
      expect(
        view.currencies.flatMap((entry) =>
          entry.yours.map((debt) => debt.toParticipantId),
        ),
      ).toEqual(["marta"]);
    });
  });

  describe("when they owe the reader", () => {
    it("offers to record the repayment received, and to remind", async () => {
      loadGroupBalances.mockResolvedValue(MARTA_OWES_SEB);
      await open("marta");

      expect(screen.getByText("Marta owes you")).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "Record Marta's repayment to Seb" }),
      ).toHaveTextContent("I was paid back");
      expect(
        screen.getByRole("button", { name: "Remind Marta" }),
      ).toBeInTheDocument();
      expect(buildPayoutHints).not.toHaveBeenCalled();
    });
  });

  it("offers nothing when the two of them are settled up", async () => {
    loadGroupBalances.mockResolvedValue(NOTHING_BETWEEN_THEM);
    await open("marta");

    expect(
      screen.getByText("You and Marta are settled up"),
    ).toBeInTheDocument();
    expect(screen.queryByText("I paid Marta")).toBeNull();
    expect(screen.queryByText("I was paid back")).toBeNull();
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
  });

  it("offers nothing on the reader's own page", async () => {
    await open("seb");

    expect(screen.getByText("Your balance in this group")).toBeInTheDocument();
    expect(screen.queryByText(/^I paid/)).toBeNull();
    expect(screen.queryByText("I was paid back")).toBeNull();
    expect(buildPayoutHints).not.toHaveBeenCalled();
    expect(listRemindRecipients).not.toHaveBeenCalled();
  });

  /**
   * A guest is a full financial participant and settles up on the settle
   * screen like anybody else, so their copy of this page offers the same.
   */
  it("offers a guest what the settle screen offers them", async () => {
    requireGroupAccess.mockResolvedValue(
      access({
        actor: {
          kind: "guest",
          groupId: "g1",
          participantId: "seb",
          displayName: "Seb",
          sessionId: "s1",
        },
        role: "guest",
      }),
    );
    await open("marta");

    expect(screen.getByText("I paid Marta")).toBeInTheDocument();
  });

  it("offers nothing to a reader with no place in the group", async () => {
    requireGroupAccess.mockResolvedValue(access({ participantId: null }));
    await open("marta");

    expect(
      screen.getByText("Marta's balance in this group"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^I paid/)).toBeNull();
    expect(screen.queryByText("I was paid back")).toBeNull();
  });
});

/**
 * The two columns a desktop window gets from `lg` up.
 *
 * The grid only places them; the document decides the order a screen reader
 * and a keyboard take, and a phone shows — so that order is pinned here: what
 * is between the two of you and the entries behind it, then the statistics.
 */
describe("the page's columns", () => {
  const column = (element: HTMLElement, slot: string) =>
    element.closest(`[data-slot="${slot}"]`);

  it("put the position and its entries first and the statistics second", async () => {
    await open("marta");

    const primary = column(screen.getByText("You owe Marta"), "member-primary");
    const secondary = column(
      screen.getByText("Statistics block"),
      "member-secondary",
    );
    expect(primary).toContainElement(
      screen.getByRole("link", { name: /^Entries with Marta/ }),
    );
    expect(secondary).not.toBeNull();
    expect(secondary?.parentElement).toBe(primary?.parentElement);
    expect(primary?.closest("[data-layout]")).toHaveAttribute(
      "data-layout",
      "wide",
    );
    expect(
      primary!.compareDocumentPosition(secondary!) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the entries behind the number", () => {
  it("opens the transactions that involve this person", async () => {
    await open("marta");

    const row = screen.getByRole("link", { name: /^Entries with Marta/ });
    expect(row).toHaveAttribute("href", "/groups/g1/expenses?with=marta");
  });

  it("calls them the reader's own on the reader's own page", async () => {
    await open("seb");

    expect(screen.getByRole("link", { name: /^Your entries/ })).toHaveAttribute(
      "href",
      "/groups/g1/expenses?with=seb",
    );
  });
});
