import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
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

function render(kind: "expense" | "settlement" = "expense") {
  return renderWithIntl(
    // The row itself is a stand-in: this wrapper is indifferent to what it
    // holds, and the real one is a link the list's own tests already cover.
    <SwipeToDelete groupId="g1" kind={kind} id="e1" description="Dinner">
      <span>Dinner</span>
    </SwipeToDelete>,
  );
}

/**
 * The fallback button, found by the sentence it is labelled with rather than
 * by its visible word. Thirty rows would otherwise offer thirty buttons all
 * called "Delete", which is a list a screen reader cannot tell apart — so the
 * label names the entry and says what removing it does.
 */
function deleteButton() {
  return screen.getByRole("button", { name: /“Dinner” will be removed/ });
}

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
