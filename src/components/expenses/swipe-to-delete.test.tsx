import { beforeEach, describe, expect, it, vi } from "vitest";
import { isInaccessible, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { SwipeToDelete } from "./swipe-to-delete";

/**
 * Deleting a transaction from the list it is sitting in.
 *
 * The gesture itself is `useSwipeAway`'s and is not re-tested here — jsdom has
 * no touch. What is tested is what happens when it fires, which is reached the
 * same way the notification inbox's tests reach its dismissal: through the
 * button that exists for anybody who is not holding a phone. Both run the same
 * handler, so the swipe has nothing of its own left to prove.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

type ById = (
  groupId: string,
  id: string,
) => Promise<{ ok: boolean; error?: string }>;

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

function render(
  kind: "expense" | "settlement" = "expense",
  locale: "en" | "fr" = "en",
) {
  return renderWithIntl(
    // The row itself is a stand-in: this wrapper is indifferent to what it
    // holds, and the real one is a link the list's own tests already cover.
    <SwipeToDelete groupId="g1" kind={kind} id="e1" description="Dinner">
      <span>Dinner</span>
    </SwipeToDelete>,
    { locale },
  );
}

/**
 * The fallback button, found by the whole of its name rather than by its
 * visible word. Thirty rows would otherwise offer thirty buttons all called
 * "Delete", which is a list a screen reader cannot tell apart — so the name
 * says which entry goes.
 */
function deleteButton() {
  return screen.getByRole("button", { name: "Delete “Dinner”" });
}

/**
 * What a keyboard or a screen reader meets on every row of the list.
 *
 * The name used to be the detail screen's confirmation sentence — "“Dinner”
 * will be removed from the group and balances will be recalculated…" — which
 * is a consequence rather than an action, read out in full on every row.
 */
describe("the delete control on a row", () => {
  it("is named for what it does and which entry it does it to", () => {
    render();

    const button = deleteButton();
    expect(button).toHaveAccessibleName("Delete “Dinner”");
    expect(button).not.toHaveAccessibleName(/will be removed/);
  });

  it("says the same in French", () => {
    render("expense", "fr");

    // Non-breaking inside the guillemets, as everywhere in the French copy.
    expect(
      screen.getByRole("button", { name: "Supprimer « Dinner »" }),
    ).toBeInTheDocument();
  });

  it("is the only Delete a screen reader finds on the row", () => {
    render();

    // The word painted behind the row for the swipe is the second "Delete" in
    // the markup. It is paint, so it stays out of the accessibility tree —
    // and the button, invisible until focused, must not go out with it.
    const words = screen.getAllByText("Delete");
    const painted = words.filter((word) => !word.closest("button"));
    expect(painted).toHaveLength(1);
    expect(isInaccessible(painted[0]!)).toBe(true);
    expect(isInaccessible(deleteButton())).toBe(false);
    expect(screen.getAllByRole("button")).toEqual([deleteButton()]);
  });

  it("is reached with Tab, as the swipe's stand-in", async () => {
    const user = userEvent.setup();
    render();

    await user.tab();

    expect(deleteButton()).toHaveFocus();
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("swiping a transaction away", () => {
  it("deletes it and leaves an Undo behind, without asking first", async () => {
    const user = userEvent.setup();
    render();

    await user.click(deleteButton());

    expect(deleteExpenseAction).toHaveBeenCalledWith("g1", "e1");
    // The list is the screen the reader is still on, so it is re-read in
    // place — there is nowhere to navigate to and nothing to navigate from.
    expect(refresh).toHaveBeenCalled();

    const [message, options] = lastToast();
    expect(message).toBe("Entry deleted");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();
    expect(restoreExpenseAction).toHaveBeenCalledWith("g1", "e1");
  });

  it("takes a repayment to the settlement actions, not the expense ones", async () => {
    const user = userEvent.setup();
    render("settlement");

    await user.click(deleteButton());

    expect(deleteSettlementAction).toHaveBeenCalledWith("g1", "e1");
    expect(deleteExpenseAction).not.toHaveBeenCalled();
  });

  /**
   * The row has already been animated off the side by the time the server
   * answers. If the answer is no, the entry is still there and the list is
   * showing a gap where it should be — so the refusal is spoken and the list
   * is put back the way the server still has it.
   */
  it("says so and restores the list when the server refuses", async () => {
    deleteExpenseAction.mockResolvedValueOnce({
      ok: false,
      error: "Not yours to delete",
    });
    const user = userEvent.setup();
    render();

    await user.click(deleteButton());

    expect(error).toHaveBeenCalledWith("Not yours to delete");
    expect(refresh).toHaveBeenCalled();
    expect(success).not.toHaveBeenCalled();
  });

  /** A second flick while the first request is out would delete a ghost. */
  it("ignores a second attempt while the first is still in flight", async () => {
    let release: (value: { ok: boolean }) => void = () => {};
    deleteExpenseAction.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const user = userEvent.setup();
    render();

    const button = deleteButton();
    await user.click(button);
    await user.click(button);
    expect(deleteExpenseAction).toHaveBeenCalledTimes(1);

    release({ ok: true });
  });
});
