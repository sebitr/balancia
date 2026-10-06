import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../../messages/en.json";
import { renderWithIntl } from "../../../../../tests/helpers/intl";
import type { GroupAccess } from "@/lib/security/authorization";
import type { GroupBalances } from "@/modules/balances/service";
import type { ParticipantSummary } from "@/modules/groups/service";
import type { RemindRecipient } from "@/modules/reminders/types";

/**
 * The People screen as the server puts it together, read at the desk: the
 * balances it already loads are what the table's Paid and Share come from,
 * and the reminder list is what puts Remind on a row.
 *
 * The page is a Server Component, called here and its output mounted, with
 * `matchMedia` answering yes to `lg` so the card draws its table.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "membersPage") =>
    createTranslator({ locale: "en", messages: en, namespace }),
  getLocale: async () => "en",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const {
  requireGroupAccess,
  listParticipants,
  loadGroupBalances,
  describeJoinLink,
  listRemindRecipients,
} = vi.hoisted(() => ({
  requireGroupAccess: vi.fn<() => Promise<GroupAccess>>(),
  listParticipants: vi.fn<() => Promise<ParticipantSummary[]>>(),
  loadGroupBalances: vi.fn<() => Promise<GroupBalances>>(),
  describeJoinLink: vi.fn(async () => ({
    status: "active" as const,
    url: "https://balancia.test/join/GROUP",
    expiresAt: null,
  })),
  listRemindRecipients: vi.fn<() => Promise<RemindRecipient[]>>(),
}));

vi.mock("@/lib/actions", () => ({ requireGroupAccess }));
vi.mock("@/modules/groups/service", () => ({ listParticipants }));
vi.mock("@/modules/balances/service", () => ({ loadGroupBalances }));
vi.mock("@/lib/security/join-link", () => ({ describeJoinLink }));
vi.mock("@/modules/reminders/service", () => ({ listRemindRecipients }));

const { default: MembersPage } = await import("./page");

function participant(
  id: string,
  displayName: string,
  role: ParticipantSummary["role"],
): ParticipantSummary {
  return {
    id,
    displayName,
    email: role === "guest" ? null : `${id}@home.lan`,
    userId: role === "guest" ? null : `u-${id}`,
    role,
    createdAt: new Date("2026-08-02T00:00:00Z"),
    hasActiveInvitation: false,
    invitationPrefix: null,
    invitationCreatedAt: null,
    invitationExpiresAt: null,
    invitationLastUsedAt: null,
  };
}

const ACCESS = {
  groupId: "g1",
  actor: { kind: "user", userId: "u-seb", name: "Seb" },
  participantId: "seb",
  role: "owner",
  permissions: {
    manageInvitations: true,
    manageParticipants: true,
    removeParticipants: true,
    leaveGroup: false,
  },
  group: {
    id: "g1",
    name: "Lisbon, March",
    currencyMode: "separate",
    baseCurrency: null,
    timezone: "Europe/Lisbon",
    archivedAt: null,
  },
} as unknown as GroupAccess;

/*
 * Two dinners in euros and an airport transfer in francs. Seb paid €120.00
 * shared with Ravi, Ravi paid €30.00 shared with Seb, and Ravi paid CHF 96.00
 * for both — so in euros Seb gets back €45.00 from Ravi, and in francs Seb
 * owes Ravi CHF 48.00.
 */
const BALANCES = {
  currencies: [
    {
      currency: "CHF",
      balances: [
        { participantId: "seb", amount: -4800n },
        { participantId: "ravi", amount: 4800n },
        { participantId: "tomas", amount: 0n },
      ],
    },
    {
      currency: "EUR",
      balances: [
        { participantId: "seb", amount: 4500n },
        { participantId: "ravi", amount: -4500n },
        { participantId: "tomas", amount: 0n },
      ],
    },
  ],
  suggestionsByCurrency: new Map(),
  participantNames: new Map(),
  spendingFacts: [
    {
      id: "dinner",
      direction: "out",
      expenseDate: "2026-08-03",
      currency: "EUR",
      payers: [{ participantId: "seb", amount: 12000n }],
      shares: [
        { participantId: "seb", amount: 6000n },
        { participantId: "ravi", amount: 6000n },
      ],
    },
    {
      id: "lunch",
      direction: "out",
      expenseDate: "2026-08-04",
      currency: "EUR",
      payers: [{ participantId: "ravi", amount: 3000n }],
      shares: [
        { participantId: "seb", amount: 1500n },
        { participantId: "ravi", amount: 1500n },
      ],
    },
    {
      id: "transfer",
      direction: "out",
      expenseDate: "2026-08-02",
      currency: "CHF",
      payers: [{ participantId: "ravi", amount: 9600n }],
      shares: [
        { participantId: "seb", amount: 4800n },
        { participantId: "ravi", amount: 4800n },
      ],
    },
  ],
} as unknown as GroupBalances;

let matchMedia: typeof window.matchMedia;

beforeEach(() => {
  matchMedia = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: query === "(min-width: 64rem)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  requireGroupAccess.mockResolvedValue(ACCESS);
  listParticipants.mockResolvedValue([
    participant("seb", "Seb", "owner"),
    participant("ravi", "Ravi", "member"),
    participant("tomas", "Tomás", "guest"),
  ]);
  loadGroupBalances.mockResolvedValue(BALANCES);
  listRemindRecipients.mockResolvedValue([]);
});

afterEach(() => {
  window.matchMedia = matchMedia;
});

async function open() {
  const page = await MembersPage({
    params: Promise.resolve({ groupId: "g1" }),
  } as never);
  return renderWithIntl(page);
}

function rowOf(name: string): HTMLElement {
  const row = screen.getByRole("link", { name }).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return row;
}

describe("the People screen at the desk", () => {
  it("fills Paid and Share from the balances it already loaded", async () => {
    await open();

    // The euro is spent in twice and the franc once, so the columns are in
    // euros and the franc is named under the table.
    const ravi = rowOf("Ravi");
    expect(ravi).toHaveTextContent("€30.00");
    expect(ravi).toHaveTextContent("€75.00");
    expect(rowOf("Seb")).toHaveTextContent("€120.00");
    expect(
      screen.getByText("Paid and share in EUR · CHF on each person’s page"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("3 people · 1 person has no account yet"),
    ).toBeInTheDocument();
  });

  it("puts Remind on the row of whoever owes the reader", async () => {
    listRemindRecipients.mockResolvedValue([
      {
        participantId: "ravi",
        name: "Ravi",
        debts: [{ amount: "4500", currency: "EUR" }],
        channel: "share",
        payWith: [],
        lastRemindedAt: null,
        locked: false,
        muted: false,
        link: { kind: "group" },
      },
    ]);
    await open();

    expect(screen.getByRole("button", { name: "Remind Ravi" })).toBeEnabled();
  });

  it("says what a click does, rather than a tap", async () => {
    await open();

    expect(
      screen.getByText(
        /^Everyone who shares expenses in this group\. Open a person/,
      ),
    ).toHaveClass("hidden", "lg:block");
    expect(
      screen.getByText(
        /^Everyone who shares expenses in this group\. Tap a person/,
      ),
    ).toHaveClass("lg:hidden");
  });

  it("keeps the group link in the same screen, after the table", async () => {
    await open();

    const table = screen.getByRole("table", { name: "People" });
    const link = screen.getByText("Group link");
    expect(
      table.compareDocumentPosition(link) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(table.closest("[data-layout]")).toHaveAttribute(
      "data-layout",
      "wide",
    );
  });
});
