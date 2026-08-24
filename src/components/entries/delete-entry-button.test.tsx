import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { DeleteEntryButton } from "./delete-entry-button";

/**
 * The detail screen's bin, at the level a person uses it: it asks, it deletes,
 * and it leaves an Undo behind on the way out.
 *
 * The server is the boundary — every action is mocked, and what is asserted is
 * what the screen does with the answer.
 */

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (to: string) => push(to),
    refresh: () => refresh(),
  }),
}));

/*
 * Hoisted with the `vi.mock` factory that hands them out, which runs before
 * the module body.
 */
type ById = (groupId: string, id: string) => Promise<{ ok: boolean }>;

const {
  deleteExpenseAction,
  deleteSettlementAction,
  restoreExpenseAction,
  restoreSettlementAction,
} = vi.hoisted(() => ({
  deleteExpenseAction: vi.fn<ById>(async () => ({ ok: true })),
  deleteSettlementAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreExpenseAction: vi.fn<ById>(async () => ({ ok: true })),
  restoreSettlementAction: vi.fn<ById>(async () => ({ ok: true })),
}));

vi.mock("@/modules/expenses/actions", () => ({
  deleteExpenseAction,
  deleteSettlementAction,
  restoreExpenseAction,
  restoreSettlementAction,
}));

/*
 * The toaster itself lives in the root layout, so in jsdom there is nothing to
 * render into. What matters here is the offer the screen makes — a success
 * message carrying an Undo — so the call is captured and its action invoked.
 */
const success = vi.fn();
const error = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => success(...args),
    error: (...args: unknown[]) => error(...args),
  },
}));

/** What the toast was raised with, as sonner would have received it. */
function lastToast() {
  return success.mock.calls.at(-1) as [
    string,
    { action: { label: string; onClick: () => void } },
  ];
}

function render(kind: "expense" | "settlement" = "expense") {
  return renderWithIntl(
    <DeleteEntryButton
      groupId="g1"
      kind={kind}
      id="e1"
      description="Dinner"
      backTo="/groups/g1/expenses?q=din"
    />,
  );
}

async function confirmDelete(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Delete" }));
  const dialog = screen.getByRole("alertdialog");
  await user.click(within(dialog).getByRole("button", { name: "Delete" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("deleting the entry on screen", () => {
  it("names the entry, and does nothing until the dialog confirms", async () => {
    const user = userEvent.setup();
    render();

    await user.click(screen.getByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("alertdialog");
    expect(within(dialog).getByText(/“Dinner” will be removed/)).toBeVisible();
    expect(deleteExpenseAction).not.toHaveBeenCalled();

    await user.click(within(dialog).getByRole("button", { name: "Keep it" }));
    expect(deleteExpenseAction).not.toHaveBeenCalled();
  });

  it("leaves for the list it came from, and offers an undo on the way", async () => {
    const user = userEvent.setup();
    render();

    await confirmDelete(user);
    expect(deleteExpenseAction).toHaveBeenCalledWith("g1", "e1");
    // The filters the reader arrived with survive the deletion.
    expect(push).toHaveBeenCalledWith("/groups/g1/expenses?q=din");

    const [message, options] = lastToast();
    expect(message).toBe("Entry deleted");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();
    expect(restoreExpenseAction).toHaveBeenCalledWith("g1", "e1");
  });

  it("puts a repayment back on the table it was deleted from", async () => {
    const user = userEvent.setup();
    render("settlement");

    await confirmDelete(user);
    expect(deleteSettlementAction).toHaveBeenCalledWith("g1", "e1");

    lastToast()[1].action.onClick();
    expect(restoreSettlementAction).toHaveBeenCalledWith("g1", "e1");
    expect(restoreExpenseAction).not.toHaveBeenCalled();
  });

  it("offers no undo for a deletion that did not happen", async () => {
    deleteExpenseAction.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render();

    await confirmDelete(user);

    expect(error).toHaveBeenCalledWith("It could not be deleted.");
    expect(success).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });
});
