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

const { setPayoutMethodsAction, setPayoutAddressAction, toastUndoable } =
  vi.hoisted(() => ({
    setPayoutMethodsAction: vi.fn(),
    setPayoutAddressAction: vi.fn(),
    toastUndoable: vi.fn(),
  }));

vi.mock("@/modules/payouts/actions", () => ({
  setPayoutMethodsAction,
  setPayoutAddressAction,
}));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));

function render(props: Partial<Parameters<typeof PayoutMethodsForm>[0]> = {}) {
  setPayoutMethodsAction.mockReset();
  setPayoutMethodsAction.mockResolvedValue({ ok: true, data: [] });
  setPayoutAddressAction.mockReset();
  setPayoutAddressAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(<PayoutMethodsForm initial={[]} {...props} />);
  return { ...view, user: userEvent.setup() };
}

/** A ticked bank row holding a Swiss IBAN, which is what opens the address. */
const SWISS = [{ method: "bank", detail: "CH93 0076 2011 6238 5295 7" }];

/** What was last sent to the server as an address. */
function lastAddress() {
  const call = setPayoutAddressAction.mock.calls.at(-1);
  if (!call) throw new Error("no address was saved");
  return call[0];
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

/**
 * The address the Swiss QR code cannot be built without.
 *
 * Its failure mode is the quiet one. An address short of what the standard
 * needs writes nothing, and for a while it also *said* nothing — so the
 * complaint that reached us was "saving the address does not work", from a
 * screen that had in fact never been asked to show one back.
 */
describe("the Swiss address", () => {
  it("appears under the IBAN that needs it, and only that one", async () => {
    const { user } = render({ initial: SWISS });

    expect(screen.getByLabelText("Postcode")).toBeInTheDocument();

    // A German account gets a Girocode, which carries no address at all.
    await user.clear(screen.getByLabelText("IBAN"));
    await user.type(
      screen.getByLabelText("IBAN"),
      "DE89 3704 0044 0532 0130 00",
    );
    expect(screen.queryByLabelText("Postcode")).toBeNull();
  });

  it("shows the address the account already holds", () => {
    render({
      initial: SWISS,
      initialAddress: {
        street: "Rue du Rhône",
        buildingNumber: "12",
        postalCode: "1204",
        town: "Genève",
        country: "CH",
      },
    });

    expect(screen.getByLabelText("Postcode")).toHaveValue("1204");
    expect(screen.getByLabelText("Town")).toHaveValue("Genève");
    expect(screen.getByLabelText("Country")).toHaveValue("CH");
  });

  it("writes it once the three the standard needs are there", async () => {
    const { user } = render({ initial: SWISS });

    await user.type(screen.getByLabelText("Postcode"), "1204");
    await user.type(screen.getByLabelText("Town"), "Genève");
    await user.type(screen.getByLabelText("Country"), "ch");
    await user.tab();

    // Upper-cased as it is typed, so what is stored is what is on screen.
    expect(lastAddress()).toMatchObject({
      postalCode: "1204",
      town: "Genève",
      country: "CH",
    });
  });

  it("says why a half-filled one was not written", async () => {
    const { user } = render({ initial: SWISS });

    await user.type(screen.getByLabelText("Postcode"), "1204");
    await user.tab();

    expect(await screen.findByText(/two-letter country/)).toBeInTheDocument();
    expect(setPayoutAddressAction).not.toHaveBeenCalled();
  });

  it("stays quiet while the block is still empty", async () => {
    const { user } = render({ initial: SWISS });

    // It opened by itself under the IBAN; nobody has typed anything yet.
    await user.click(screen.getByLabelText("Postcode"));
    await user.tab();

    expect(screen.queryByText(/two-letter country/)).toBeNull();
  });

  it("sends one write for the five fields, not five", async () => {
    const { user } = render({
      initial: SWISS,
      initialAddress: {
        street: null,
        buildingNumber: null,
        postalCode: "1204",
        town: "Genève",
        country: "CH",
      },
    });

    // Tabbing across an address nobody changed is not an edit.
    await user.click(screen.getByLabelText("Postcode"));
    await user.tab();
    await user.tab();
    await user.tab();

    expect(setPayoutAddressAction).not.toHaveBeenCalled();
  });

  it("reports a refusal rather than dropping it", async () => {
    const { user } = render({ initial: SWISS });
    setPayoutAddressAction.mockResolvedValue({
      ok: false,
      error: "That could not be saved.",
    });

    await user.type(screen.getByLabelText("Postcode"), "1204");
    await user.type(screen.getByLabelText("Town"), "Genève");
    await user.type(screen.getByLabelText("Country"), "CH");
    await user.tab();

    expect(
      await screen.findByText("That could not be saved."),
    ).toBeInTheDocument();
  });

  it("sends nothing for a guest", async () => {
    const { user } = render({ initial: SWISS, persist: false });

    await user.type(screen.getByLabelText("Postcode"), "1204");
    await user.type(screen.getByLabelText("Town"), "Genève");
    await user.type(screen.getByLabelText("Country"), "CH");
    await user.tab();

    expect(setPayoutAddressAction).not.toHaveBeenCalled();
  });
});
