import { describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PushCard } from "./push-card";

/**
 * Push for the browser you are looking at, and the list of the others.
 *
 * Turning it off is the one worth taking back: the permission is still granted
 * afterwards, so undoing it resubscribes rather than reopening the browser's
 * own dialog — which is what makes the offer honest. Removing a *different*
 * device is not undoable in the same way, because that browser has to ask for
 * itself, so that one says what happened and stops.
 */

const { enable, disable, toastUndoable, subscription } = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  toastUndoable: vi.fn(),
  subscription: { status: "on", busy: false, error: null },
}));

vi.mock("@/components/notifications/use-push-subscription", () => ({
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

const DEVICES = [
  { id: "d1", label: "iPhone · Safari", added: "Added 19 Aug" },
  { id: "d2", label: "Pixel · Chrome", added: "Added 2 Aug" },
];

function renderCard(devices = DEVICES) {
  enable.mockReset().mockResolvedValue(true);
  disable.mockReset().mockResolvedValue(true);
  toastUndoable.mockReset();
  const view = renderWithIntl(<PushCard devices={devices} />);
  return { ...view, user: userEvent.setup() };
}

const here = () => screen.getByRole("switch", { name: /Push to this device/ });

describe("PushCard", () => {
  it("offers to put this device back after turning it off", async () => {
    const { user } = renderCard();

    expect(here()).toBeChecked();
    await user.click(here());

    expect(disable).toHaveBeenCalledOnce();
    const [message, undo, options] = toastUndoable.mock.calls[0];
    expect(message).toBe("That device will no longer be notified.");
    expect(options?.id).toBe("push-subscription");

    await act(async () => undo.onUndo());

    expect(enable).toHaveBeenCalledOnce();
  });

  it("says nothing when the browser refused to unsubscribe", async () => {
    const { user } = renderCard();
    disable.mockResolvedValue(false);

    await user.click(here());

    expect(toastUndoable).not.toHaveBeenCalled();
  });

  it("lists the devices already subscribed", () => {
    renderCard();

    expect(screen.getByText("iPhone · Safari")).toBeInTheDocument();
    expect(screen.getByText("Pixel · Chrome")).toBeInTheDocument();
  });

  it("forgets another device by its row id, never by its endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204 } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { user } = renderCard();
    await user.click(
      screen.getByRole("button", { name: /Remove — Pixel · Chrome/ }),
    );

    // The endpoint is a capability to send to somebody's phone and never
    // reaches a page; the row id is what the list has to work with.
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith("/api/push/subscriptions/d2", {
        method: "DELETE",
      }),
    );
    vi.unstubAllGlobals();
  });

  it("draws no device list when nothing is subscribed", () => {
    renderCard([]);
    expect(screen.queryByText("Devices")).toBeNull();
  });
});
