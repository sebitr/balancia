import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { RecurringRowActions } from "./recurring-row-actions";

/**
 * The recurring row's menu, at the level a person uses it.
 *
 * Both of the things it does can be taken back — a pause by pausing the other
 * way, a removal by the server putting the template back — so both leave an
 * Undo behind. The server is the boundary: every action is mocked, and what is
 * asserted is what the screen does with the answer.
 */

const refresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => refresh() }),
}));

const {
  deleteRecurringAction,
  restoreRecurringAction,
  setRecurringPausedAction,
} = vi.hoisted(() => ({
  deleteRecurringAction: vi.fn<
    (groupId: string, templateId: string) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true })),
  restoreRecurringAction: vi.fn<
    (groupId: string, templateId: string) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true })),
  setRecurringPausedAction: vi.fn<
    (
      groupId: string,
      templateId: string,
      paused: boolean,
    ) => Promise<{ ok: boolean }>
  >(async () => ({ ok: true })),
}));

vi.mock("@/modules/recurring/actions", () => ({
  deleteRecurringAction,
  restoreRecurringAction,
  setRecurringPausedAction,
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

function lastToast() {
  return success.mock.calls.at(-1) as [
    string,
    { action: { label: string; onClick: () => void } },
  ];
}

function render(paused = false) {
  return renderWithIntl(
    <RecurringRowActions
      groupId="g1"
      templateId="r1"
      description="Rent"
      paused={paused}
    />,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Actions for Rent" }));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("removing a recurring expense", () => {
  it("asks first, and says the removal can be taken back", async () => {
    const user = userEvent.setup();
    render();

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText("Remove “Rent”?")).toBeVisible();
    expect(
      within(dialog).getByText(/You can undo this right after/),
    ).toBeVisible();
    expect(deleteRecurringAction).not.toHaveBeenCalled();
  });

  it("offers an undo that puts the template back", async () => {
    const user = userEvent.setup();
    render();

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(deleteRecurringAction).toHaveBeenCalledWith("g1", "r1");
    const [message, options] = lastToast();
    expect(message).toBe("Recurring expense removed");
    expect(options.action.label).toBe("Undo");

    options.action.onClick();
    expect(restoreRecurringAction).toHaveBeenCalledWith("g1", "r1");
  });

  it("offers no undo for a removal that did not happen", async () => {
    deleteRecurringAction.mockResolvedValueOnce({ ok: false });
    const user = userEvent.setup();
    render();

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(error).toHaveBeenCalledWith("That did not work.");
    expect(success).not.toHaveBeenCalled();
  });
});

describe("pausing a recurring expense", () => {
  it("undoes a pause by resuming it, not by pausing it again", async () => {
    const user = userEvent.setup();
    render();

    await openMenu(user);
    await user.click(await screen.findByRole("menuitem", { name: "Pause" }));

    expect(setRecurringPausedAction).toHaveBeenCalledWith("g1", "r1", true);
    expect(lastToast()[0]).toBe("Paused");

    lastToast()[1].action.onClick();
    expect(setRecurringPausedAction).toHaveBeenLastCalledWith(
      "g1",
      "r1",
      false,
    );
  });
});
