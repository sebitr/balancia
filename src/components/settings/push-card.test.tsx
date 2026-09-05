import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PushCard } from "./push-card";

/**
 * Push for the browser you are looking at, and the list of the others.
 *
 * The switch is its own way back: turning push off leaves the permission
 * granted, so turning it on again is a resubscribe under the same finger
 * rather than the browser's dialog a second time — which is precisely why it
 * confirms nothing. Removing a *different* device is not that: the row leaves
 * the screen, that browser has to ask for itself, and so that one does say
 * what happened.
 */

const { enable, disable, toastSuccess, subscription } = vi.hoisted(() => ({
  enable: vi.fn(),
  disable: vi.fn(),
  toastSuccess: vi.fn(),
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
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));
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
  toastSuccess.mockReset();
  const view = renderWithIntl(<PushCard devices={devices} />);
  return { ...view, user: userEvent.setup() };
}

const here = () => screen.getByRole("switch", { name: /Push to this device/ });

describe("PushCard", () => {
  it("turns this device off from the switch, and says nothing about it", async () => {
    const { user } = renderCard();

    expect(here()).toBeChecked();
    await user.click(here());

    expect(disable).toHaveBeenCalledOnce();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("puts it back from the same switch, in one tap and in silence", async () => {
    // Where the card is left standing after the switch above was turned off.
    subscription.status = "off";
    const { user } = renderCard();

    await user.click(here());

    // The permission survived the unsubscribe, so this is the resubscribe an
    // Undo button in a toast would have run — one tap, in the same place.
    expect(enable).toHaveBeenCalledOnce();
    expect(toastSuccess).not.toHaveBeenCalled();
    subscription.status = "on";
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
    // The row is gone from the screen and no switch can bring it back, so
    // this one does say what happened.
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "That device will no longer be notified.",
      ),
    );
    vi.unstubAllGlobals();
  });

  it("draws no device list when nothing is subscribed", () => {
    renderCard([]);
    expect(screen.queryByText("Devices")).toBeNull();
  });
});
