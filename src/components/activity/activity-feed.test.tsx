import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { ActivityEntry } from "@/modules/activity/service";
import { ActivityFeed } from "./activity-feed";

/**
 * The group's history, and the Restore it carries on a deletion that still
 * stands — the way back that does not run out after eight seconds.
 *
 * The feed renders on the server; here it is awaited and its output mounted,
 * with the real English catalogue behind both halves. The server is the
 * boundary: the restores are mocked, and what is asserted is what the row does
 * with their answer.
 */

// The feed asks for exactly one namespace, which is all this answers.
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "activity") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

vi.mock("@/i18n/preferences", () => ({
  getDateFormatter: async () => ({ at: (date: Date) => date.toISOString() }),
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
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("restoring from the activity feed", () => {
  it("offers a restore only on deletions that still stand", async () => {
    renderWithIntl(await feed(["a1", "a2", "a3"]));

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
    renderWithIntl(await feed(["a1", "a2", "a3"]));

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
    renderWithIntl(await feed(["a1"]));

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
    const { rerender } = renderWithIntl(await feed(["a1"]));

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
    renderWithIntl(await feed(["a1"]));

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

  it("does not send a second restore while the first is out", async () => {
    let settle: (value: { ok: boolean }) => void = () => {};
    restoreExpenseAction.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = resolve;
      }),
    );
    const user = userEvent.setup();
    renderWithIntl(await feed(["a1"]));

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
