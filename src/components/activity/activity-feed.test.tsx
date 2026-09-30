import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { createDateFormatter } from "@/i18n/format";
import type { ActivityEntry } from "@/modules/activity/service";
import { ActivityFeed } from "./activity-feed";

/**
 * The group's history: the clock it tells the time on, and the Restore it
 * carries on a deletion that still stands — the way back that does not run
 * out after eight seconds.
 *
 * The feed renders on the server; here it is awaited and its output mounted,
 * with the real English catalogue behind both halves — the whole of it for the
 * server's, and for the browser's only what the group area's provider carries,
 * which is all the Restore button is handed on the Activity screen. Given the
 * whole catalogue, these tests passed while that provider did not carry
 * `activity.restore`, and the button printed its keys in the app. The server
 * is the boundary: the restores are mocked, and what is asserted is what the
 * row does with their answer.
 */

// The feed asks for exactly one namespace, which is all this answers.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "activity") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

/*
 * The server's formatter, UTC and all. The app's own zone is the server's —
 * UTC unless an operator set `TZ` — which is exactly the situation the feed
 * has to correct for by telling each time on the group's clock.
 */
vi.mock("@/i18n/preferences", () => ({
  getDateFormatter: async () =>
    createDateFormatter({
      dateFormat: "dmy",
      formatLocale: "en-GB",
      timeZone: "UTC",
    }),
  getNumberLocale: async () => "en-GB",
}));

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

type ById = (
  groupId: string,
  id: string,
) => Promise<{ ok: boolean; error?: string }>;

const {
  restoreExpenseAction,
  restoreSettlementAction,
  restoreRecurringAction,
} = vi.hoisted(() => ({
  restoreExpenseAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreSettlementAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreRecurringAction: vi.fn<ById>(async () => ({ ok: true })),
}));

vi.mock("@/modules/expenses/actions", () => ({
  restoreExpenseAction,
  restoreSettlementAction,
}));
vi.mock("@/modules/recurring/actions", () => ({ restoreRecurringAction }));

const success = vi.fn();
const error = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

function event(
  fields: Pick<ActivityEntry, "id" | "action" | "entityType"> &
    Partial<ActivityEntry>,
): ActivityEntry {
  return {
    entityId: null,
    metadata: null,
    actorLabel: "Ada",
    actorType: "user",
    createdAt: new Date("2026-09-01T10:00:00Z"),
    ...fields,
  };
}

const DINNER_DELETED = event({
  id: "a1",
  action: "expense.deleted",
  entityType: "expense",
  entityId: "e1",
  metadata: { description: "Dinner", amount: "3000", currency: "EUR" },
});

const REPAYMENT_DELETED = event({
  id: "a2",
  action: "settlement.deleted",
  entityType: "settlement",
  entityId: "s1",
  metadata: { amount: "2000", currency: "EUR" },
});

const RENT_DELETED = event({
  id: "a3",
  action: "recurring.deleted",
  entityType: "recurring_expense",
  entityId: "r1",
  metadata: { description: "Rent" },
});

/** Deleted, and put back since: the server no longer lists it. */
const TAXI_DELETED = event({
  id: "a4",
  action: "expense.deleted",
  entityType: "expense",
  entityId: "e2",
  metadata: { description: "Taxi", amount: "1200", currency: "EUR" },
});

const LUNCH_ADDED = event({
  id: "a5",
  action: "expense.created",
  entityType: "expense",
  entityId: "e3",
  metadata: { description: "Lunch" },
});

const ENTRIES = [
  DINNER_DELETED,
  REPAYMENT_DELETED,
  RENT_DELETED,
  TAXI_DELETED,
  LUNCH_ADDED,
];

async function feed(restorable: readonly string[]) {
  return ActivityFeed({
    entries: ENTRIES,
    groupId: "g1",
    restorable: new Set(restorable),
    timeZone: "UTC",
  });
}

/** Where the Activity screen renders: under the group layout's provider. */
const GROUP = { area: "group" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the activity feed's clock", () => {
  const ADDED = event({
    id: "a1",
    action: "expense.created",
    entityType: "expense",
    entityId: "e1",
    metadata: { description: "Groceries" },
    // Five past two in the afternoon in UTC; five past four in Paris, which is
    // on summer time in August.
    createdAt: new Date("2026-08-13T14:05:00Z"),
  });

  it("tells the time on the group's clock, not the server's", async () => {
    renderWithIntl(
      await ActivityFeed({
        entries: [ADDED],
        groupId: "g1",
        restorable: new Set(),
        timeZone: "Europe/Paris",
      }),
      GROUP,
    );

    const time = screen.getByText(/16:05/);
    expect(time).toHaveTextContent("13/08/2026, 16:05");
    // The machine-readable instant is still the instant.
    expect(time).toHaveAttribute("datetime", "2026-08-13T14:05:00.000Z");
    expect(screen.queryByText(/14:05/)).not.toBeInTheDocument();
  });

  it("moves the day with the clock", async () => {
    // A quarter to midnight in UTC is already tomorrow in Auckland.
    renderWithIntl(
      await ActivityFeed({
        entries: [{ ...ADDED, createdAt: new Date("2026-08-13T23:45:00Z") }],
        groupId: "g1",
        restorable: new Set(),
        timeZone: "Pacific/Auckland",
      }),
      GROUP,
    );

    expect(screen.getByText(/11:45/)).toHaveTextContent("14/08/2026, 11:45");
  });
});

describe("restoring from the activity feed", () => {
  it("offers a restore only on deletions that still stand", async () => {
    renderWithIntl(await feed(["a1", "a2", "a3"]), GROUP);

    // Each one named for what it puts back, starting with the word it shows.
    expect(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Restore the repayment of €20.00" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", {
        name: "Restore the recurring expense “Rent”",
      }),
    ).toBeVisible();

    // Taxi was put back already, and a new expense has nothing to restore.
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.queryByRole("button", { name: /Taxi/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Lunch/ })).toBeNull();
  });

  it("calls the restore for the kind and the entry the row names", async () => {
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1", "a2", "a3"]), GROUP);

    await user.click(
      screen.getByRole("button", { name: "Restore the repayment of €20.00" }),
    );
    expect(restoreSettlementAction).toHaveBeenCalledWith("g1", "s1");

    await user.click(
      screen.getByRole("button", {
        name: "Restore the recurring expense “Rent”",
      }),
    );
    expect(restoreRecurringAction).toHaveBeenCalledWith("g1", "r1");

    await user.click(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    );
    expect(restoreExpenseAction).toHaveBeenCalledWith("g1", "e1");
  });

  it("can be reached and pressed from the keyboard", async () => {
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    await user.tab();
    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    expect(button).toHaveFocus();

    await user.keyboard("{Enter}");
    expect(restoreExpenseAction).toHaveBeenCalledWith("g1", "e1");
  });

  /**
   * No toast: the row changes under the finger that pressed it, which is the
   * confirmation. The word that replaces the button takes its focus, so a
   * keyboard is not dropped at the top of the page.
   */
  it("goes quiet once it has worked, and leaves the focus on the row", async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithIntl(await feed(["a1"]), GROUP);

    await user.click(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    );

    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
    expect(screen.queryByRole("button")).toBeNull();
    expect(refresh).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();

    // The refresh brings the page back without Dinner among the deletions
    // still standing. The row keeps its word, and the word keeps the focus.
    rerender(await feed([]));
    expect(screen.getByText("Restored")).toHaveFocus();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says why when the restore is refused, and keeps the button", async () => {
    restoreExpenseAction.mockResolvedValueOnce({
      ok: false,
      error: "That expense is not part of this group.",
    });
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    await user.click(button);

    expect(error).toHaveBeenCalledWith(
      "That expense is not part of this group.",
    );
    expect(success).not.toHaveBeenCalled();
    expect(screen.queryByText("Restored")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Restore the expense “Dinner”" }),
    ).toBeVisible();
    // And asks the server what is true now, in case somebody else put it back.
    expect(refresh).toHaveBeenCalled();
  });

  /**
   * The button's name is written on the server, from the whole catalogue, and
   * would read correctly with nothing in the browser at all. Its three words —
   * the one it shows, the refusal it falls back on, the one it turns into —
   * are read in the browser, from the group's provider.
   */
  it("finds its own words in what the group's provider carries", async () => {
    restoreExpenseAction.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    expect(button).toHaveTextContent(/^Restore$/);

    await user.click(button);
    expect(error).toHaveBeenCalledWith("It could not be put back. Try again.");

    await user.click(button);
    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
  });

  it("does not send a second restore while the first is out", async () => {
    let settle: (value: { ok: boolean }) => void = () => {};
    restoreExpenseAction.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]), GROUP);

    const button = screen.getByRole("button", {
      name: "Restore the expense “Dinner”",
    });
    await user.click(button);
    await user.click(button);

    expect(restoreExpenseAction).toHaveBeenCalledTimes(1);
    // Still the focused control while it waits: marked busy, not disabled.
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveFocus();

    settle({ ok: true });
    await waitFor(() => expect(screen.getByText("Restored")).toHaveFocus());
  });
});
