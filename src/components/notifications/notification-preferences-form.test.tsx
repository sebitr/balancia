import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { NotificationPreferencesForm } from "./notification-preferences-form";

/**
 * The switches that decide what raises a notification at all.
 *
 * Each is written as it is flicked, and none of them says so: the switch that
 * moved and stayed moved is the confirmation, and flicking it again is the
 * whole of the way back — so a toast would be a second, slower copy of the
 * control under the finger. That is asserted rather than assumed, because the
 * confirmation is exactly what creeps back in.
 *
 * A refused write is the one thing the switch cannot report itself: it goes
 * back rather than lying about what was saved, and the error is spoken.
 */

const { savePreferencesAction, toastSuccess, toastError } = vi.hoisted(() => ({
  savePreferencesAction: vi.fn(),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/notifications/actions", () => ({ savePreferencesAction }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

const ALL_ON = {
  expenses: true,
  settlements: true,
  recurring: true,
  imports: true,
  reminders: true,
};

function renderForm() {
  savePreferencesAction.mockReset();
  savePreferencesAction.mockResolvedValue({ ok: true });
  toastSuccess.mockReset();
  toastError.mockReset();
  const view = renderWithIntl(
    <NotificationPreferencesForm defaultValue={ALL_ON} />,
  );
  return { ...view, user: userEvent.setup() };
}

const expenses = () => screen.getByRole("switch", { name: "Expenses I am in" });

describe("NotificationPreferencesForm", () => {
  it("writes a switch as it is flicked, and says nothing about it", async () => {
    const { user } = renderForm();

    await user.click(expenses());

    await waitFor(() =>
      expect(savePreferencesAction).toHaveBeenCalledWith({
        ...ALL_ON,
        expenses: false,
      }),
    );
    expect(expenses()).not.toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("flicks back to where it started, in one tap and in silence", async () => {
    const { user } = renderForm();

    await user.click(expenses());
    await waitFor(() => expect(expenses()).toBeEnabled());
    await user.click(expenses());

    await waitFor(() =>
      expect(savePreferencesAction).toHaveBeenLastCalledWith(ALL_ON),
    );
    expect(expenses()).toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("puts the switch back when the write is refused, and says so", async () => {
    const { user } = renderForm();
    savePreferencesAction.mockResolvedValue({ ok: false });

    await user.click(expenses());

    await waitFor(() => expect(expenses()).toBeChecked());
    expect(toastError).toHaveBeenCalledWith(
      "Those settings could not be saved.",
    );
  });
});
