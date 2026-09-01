import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";
import type { EditingEntry } from "@/components/entries/add-entry-form";

/**
 * What the entry screen does when the entry is not there any more.
 *
 * Both answers are right, and which one is right depends entirely on whether
 * this is a screen or a slot. A screen a cold link lands on should say the
 * entry is gone. The slot held over the group must not: it goes on rendering
 * after the reader has left it — a parallel slot keeps its active subpage
 * across a client-side navigation even when the new URL does not match — and
 * the refresh that follows a conversion asks it to render precisely when the
 * entry it names has just stopped existing. A 404 from there takes the group
 * down with it, and the reader ends up on the not-found screen with the
 * group's own URL in the address bar.
 */

const { notFound, getExpense, getSettlement } = vi.hoisted(() => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  getExpense: vi.fn(),
  getSettlement: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound }));
vi.mock("@/modules/expenses/service", () => ({
  getExpense,
  // The duplicate note reads the group's last few entries; this suite is
  // about what happens when the *edited* one is gone.
  listExpenses: async () => [],
}));
vi.mock("@/modules/settlements/service", () => ({ getSettlement }));
vi.mock("@/lib/actions", () => ({
  requireGroupAccess: async () => ({
    groupId: "g1",
    participantId: "seb",
    permissions: { manageParticipants: true },
    group: {
      currencyMode: "converted",
      baseCurrency: "CHF",
      timezone: "Europe/Zurich",
    },
  }),
}));
vi.mock("@/modules/groups/service", () => ({
  listParticipants: async () => [{ id: "seb", displayName: "Seb" }],
}));
vi.mock("@/modules/categorization/service", () => ({
  loadMappings: async () => [],
  loadFrequentCategories: async () => [],
}));
vi.mock("@/modules/balances/service", () => ({
  loadGroupBalances: async () => ({ suggestionsByCurrency: new Map() }),
}));
vi.mock("@/i18n/preferences", () => ({ getNumberLocale: async () => "fr-CH" }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/env", () => ({
  configuredOcrProviderName: () => null,
  isLocalReceiptOcrEnabled: () => false,
  isReceiptScanningEnabled: () => false,
  isSemanticCategorizationEnabled: () => false,
}));
// The drawer is a client component and drags the whole form in with it; what
// is under test is the decision above it.
vi.mock("@/components/entries/add-entry-drawer", () => ({
  AddEntryDrawer: () => null,
}));

const { EntryScreen } = await import("./entry-screen");

/**
 * The `editing` the screen hands the drawer.
 *
 * `EntryScreen` returns an element rather than rendered output — the drawer is
 * a client component, mocked to nothing above and never invoked — so the props
 * it was built with are read straight off the tree.
 */
function editingOf(screen: unknown): EditingEntry {
  const root = screen as ReactElement<{ children?: unknown }>;
  const children = root.props.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const candidate = child as ReactElement<{ editing?: EditingEntry }> | null;
    if (candidate?.props?.editing) return candidate.props.editing;
  }
  throw new Error("the screen drew no drawer carrying an `editing`");
}

beforeEach(() => {
  notFound.mockClear();
  getExpense.mockReset();
  getSettlement.mockReset();
});

describe("an entry that is no longer there", () => {
  it("renders nothing when it is the slot over the group", async () => {
    getExpense.mockResolvedValue(null);

    const screen = await EntryScreen({
      groupId: "g1",
      dismissTo: "back",
      edit: { kind: "expense", id: "e1" },
      whenGone: "nothing",
    });

    expect(screen).toBeNull();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("says so when it is the screen a link lands on", async () => {
    getExpense.mockResolvedValue(null);

    await expect(
      EntryScreen({
        groupId: "g1",
        dismissTo: "group",
        edit: { kind: "expense", id: "e1" },
      }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalled();
  });

  it("holds the same for a repayment reopened as a slot", async () => {
    getSettlement.mockResolvedValue(null);

    const screen = await EntryScreen({
      groupId: "g1",
      dismissTo: "back",
      edit: { kind: "settlement", id: "s1" },
      whenGone: "nothing",
    });

    expect(screen).toBeNull();
    expect(notFound).not.toHaveBeenCalled();
  });

  it("still draws the drawer when the entry is there", async () => {
    getExpense.mockResolvedValue({
      id: "e1",
      direction: "out",
      amount: 8460n,
      currency: "CHF",
      exchangeRate: null,
      expenseDate: "2026-08-12",
      description: "Migros",
      category: null,
      notes: null,
      payers: [{ participantId: "seb", amount: 8460n }],
      shares: [{ participantId: "seb", amount: 8460n }],
      splitMethod: "equal",
      splitInput: null,
    });

    const screen = await EntryScreen({
      groupId: "g1",
      dismissTo: "back",
      edit: { kind: "expense", id: "e1" },
      whenGone: "nothing",
    });

    expect(screen).not.toBeNull();
    expect(notFound).not.toHaveBeenCalled();
  });

  /**
   * The one this file is here to keep out. Editing read `payers[0]` and let
   * the rest go, so reopening a two-payer expense — one made through the API,
   * or brought in by an import — and saving it wrote back a one-payer expense
   * holding the whole amount. Nothing said so, and the balances moved.
   */
  it("brings every payer back, not just the first", async () => {
    getExpense.mockResolvedValue({
      id: "e1",
      direction: "out",
      amount: 9000n,
      currency: "CHF",
      exchangeRate: null,
      expenseDate: "2026-08-12",
      description: "Boat",
      category: null,
      notes: null,
      payers: [
        { participantId: "seb", amount: 6000n },
        { participantId: "grace", amount: 3000n },
      ],
      shares: [
        { participantId: "seb", amount: 4500n },
        { participantId: "grace", amount: 4500n },
      ],
      splitMethod: "equal",
      splitInput: null,
    });

    const screen = await EntryScreen({
      groupId: "g1",
      dismissTo: "back",
      edit: { kind: "expense", id: "e1" },
      whenGone: "nothing",
    });

    expect(editingOf(screen).payers).toEqual([
      { participantId: "seb", amountText: "60.00" },
      { participantId: "grace", amountText: "30.00" },
    ]);
  });
});
