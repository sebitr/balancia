import { describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PushToggle } from "./push-toggle";

/**
 * Turning push on or off for the browser you are looking at.
 *
 * Turning it off is the one worth taking back: the permission is still
 * granted afterwards, so undoing it resubscribes rather than reopening the
 * browser's own dialog — which is what makes the offer honest.
 */

const { enable, disable, toastUndoable, subscription } = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  toastUndoable: vi.fn(),
  subscription: { status: "on", busy: false, error: null },
}));

vi.mock("./use-push-subscription", () => ({
  usePushSubscription: () => ({
    ...subscription,
    enable,
    disable,
    refresh: vi.fn(),
  }),
}));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

function renderToggle() {
  enable.mockReset().mockResolvedValue(true);
  disable.mockReset().mockResolvedValue(true);
  toastUndoable.mockReset();
  const view = renderWithIntl(<PushToggle />);
  return { ...view, user: userEvent.setup() };
}

describe("PushToggle", () => {
  it("offers to put the device back after turning it off", async () => {
    const { user } = renderToggle();

    await user.click(
      screen.getByRole("button", { name: "Turn off for this device" }),
    );

    expect(disable).toHaveBeenCalledOnce();
    const [message, undo, options] = toastUndoable.mock.calls[0];
    expect(message).toBe("That device will no longer be notified.");
    expect(options?.id).toBe("push-subscription");

    await act(async () => undo.onUndo());

    expect(enable).toHaveBeenCalledOnce();
  });

  it("says nothing when the browser refused to unsubscribe", async () => {
    const { user } = renderToggle();
    disable.mockResolvedValue(false);

    await user.click(
      screen.getByRole("button", { name: "Turn off for this device" }),
    );

    expect(toastUndoable).not.toHaveBeenCalled();
  });
});
