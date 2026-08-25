import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PayoutMethodsForm } from "./payout-methods-form";

/**
 * The one form in settings that waits for its write.
 *
 * Everywhere else a tap is sent in the background and a failure costs somebody
 * a preference. Here it costs them the money they were owed, found out when it
 * does not arrive — so nothing is sent until it is valid, the send is awaited,
 * and a refusal puts the list back rather than leaving a row showing a detail
 * the account did not keep.
 */

const { setPayoutMethodsAction, toastUndoable } = vi.hoisted(() => ({
  setPayoutMethodsAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/payouts/actions", () => ({ setPayoutMethodsAction }));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));

function render(props: Partial<Parameters<typeof PayoutMethodsForm>[0]> = {}) {
  setPayoutMethodsAction.mockReset();
  setPayoutMethodsAction.mockResolvedValue({ ok: true, data: [] });
  toastUndoable.mockReset();
  const view = renderWithIntl(<PayoutMethodsForm initial={[]} {...props} />);
  return { ...view, user: userEvent.setup() };
}

/** What was last sent to the server, as methods and details. */
function lastSaved() {
  const call = setPayoutMethodsAction.mock.calls.at(-1);
  if (!call) throw new Error("nothing was saved");
  return call[0].methods;
}

describe("picking a method", () => {
  it("opens the one field that method needs, and no others", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: /Bank transfer/ }));

    expect(screen.getByLabelText("IBAN")).toBeInTheDocument();
    expect(screen.queryByLabelText("Phone number")).toBeNull();
  });

  it("asks for nothing where there is nobody to send to", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: "Cash" }));

    // Cash is a complete answer on its own, so it saves on the tick.
    expect(lastSaved()).toEqual([{ method: "cash", detail: "" }]);
  });

  it("does not save a method whose detail is still missing", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: /Bank transfer/ }));

    // There is nothing to save yet, and sending it would only be refused.
    expect(setPayoutMethodsAction).not.toHaveBeenCalled();
  });
});

describe("the detail", () => {
  it("saves an IBAN that checks out, once the field is left", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: /Bank transfer/ }));
    await user.type(
      screen.getByLabelText("IBAN"),
      "CH93 0076 2011 6238 5295 7",
    );
    // Nothing yet: an IBAN is invalid for the whole time it is being typed.
    expect(setPayoutMethodsAction).not.toHaveBeenCalled();

    await user.tab();
    // Sent as typed: stripping the spacing an IBAN is read out in is the
    // server's job, so that a request written by hand is normalised too.
    expect(lastSaved()).toEqual([
      { method: "bank", detail: "CH93 0076 2011 6238 5295 7" },
    ]);
  });

  it("names what is wrong with an IBAN rather than refusing silently", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: /Bank transfer/ }));
    await user.type(
      screen.getByLabelText("IBAN"),
      "CH93 0076 2011 6238 5295 8",
    );
    await user.tab();

    expect(screen.getByText(/does not check out/)).toBeInTheDocument();
    expect(setPayoutMethodsAction).not.toHaveBeenCalled();
  });

  it("stops complaining while it is being corrected", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: /Bank transfer/ }));
    const field = screen.getByLabelText("IBAN");
    await user.type(field, "nonsense");
    await user.tab();
    expect(screen.getByText(/does not check out/)).toBeInTheDocument();

    await user.type(field, "x");
    expect(screen.queryByText(/does not check out/)).toBeNull();
  });
});

describe("when the write is refused", () => {
  it("puts the list back rather than showing what was not kept", async () => {
    const { user } = render();
    setPayoutMethodsAction.mockResolvedValue({
      ok: false,
      error: "Bank transfer — that IBAN does not check out.",
    });

    await user.click(screen.getByRole("checkbox", { name: "Cash" }));

    expect(
      await screen.findByText(/that IBAN does not check out/),
    ).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Cash" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });
});

describe("a guest", () => {
  it("keeps the list for the visit and sends nothing", async () => {
    const { user } = render({ persist: false });

    await user.click(screen.getByRole("checkbox", { name: "Cash" }));

    expect(screen.getByRole("checkbox", { name: "Cash" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // There is no account to store it on, so nothing is sent to be stored.
    expect(setPayoutMethodsAction).not.toHaveBeenCalled();
  });
});

describe("confirmations", () => {
  it("offers a way back on the settings screen", async () => {
    const { user } = render();

    await user.click(screen.getByRole("checkbox", { name: "Cash" }));

    await vi.waitFor(() => expect(toastUndoable).toHaveBeenCalled());
  });

  it("raises nothing inside a sheet, where its Undo would take no taps", async () => {
    const { user } = render({ confirmations: "silent" });

    await user.click(screen.getByRole("checkbox", { name: "Cash" }));

    await vi.waitFor(() => expect(setPayoutMethodsAction).toHaveBeenCalled());
    expect(toastUndoable).not.toHaveBeenCalled();
  });
});
