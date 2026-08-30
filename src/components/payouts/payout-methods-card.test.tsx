import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PayoutMethodsCard } from "./payout-methods-card";

/**
 * The list of ways you are paid back.
 *
 * Three things are worth holding here, because all three are ways the money
 * quietly does not arrive:
 *
 *  - **Order is the preference.** Whoever owes you is shown the top one, so
 *    promoting a method has to move it and has to be written.
 *  - **A bad detail is never sent.** The screen validates on the server's own
 *    rules before it writes, and says which row is wrong.
 *  - **A refused write puts the list back.** A row showing an IBAN the account
 *    did not keep is the exact failure this screen exists to avoid.
 *
 * The Swiss address is the fourth: it waits for the IBAN to say `CH`, and
 * takes itself away again once that IBAN belongs to a country whose code
 * carries no address.
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

const TWINT = { method: "twint", detail: "+41786276780" };
const BANK = { method: "bank", detail: "CH9300762011623852957" };

function renderCard(initial: { method: string; detail: string }[] = []) {
  setPayoutMethodsAction.mockReset();
  setPayoutMethodsAction.mockResolvedValue({ ok: true });
  setPayoutAddressAction.mockReset();
  setPayoutAddressAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(<PayoutMethodsCard initial={initial} />);
  return { ...view, user: userEvent.setup() };
}

/** The order the rows are in, which is the order whoever owes you sees. */
const written = () =>
  setPayoutMethodsAction.mock.calls
    .at(-1)?.[0]
    .methods.map((entry: { method: string }) => entry.method);

describe("PayoutMethodsCard", () => {
  it("moves a method to the top when it is made preferred, and writes it", async () => {
    const { user } = renderCard([BANK, TWINT]);

    expect(screen.getByText("Preferred")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Make preferred" }));

    await waitFor(() => expect(written()).toEqual(["twint", "bank"]));
    // The badge follows the row, so exactly one method claims to be preferred.
    expect(screen.getAllByText("Preferred")).toHaveLength(1);
  });

  it("removes a method and writes the shorter list", async () => {
    const { user } = renderCard([BANK, TWINT]);

    await user.click(screen.getByRole("button", { name: "Remove TWINT" }));

    await waitFor(() => expect(written()).toEqual(["bank"]));
  });

  it("does not send a detail the server would refuse", async () => {
    const { user } = renderCard([{ method: "twint", detail: "" }]);

    const field = screen.getByLabelText("Phone number");
    await user.type(field, "0786276780");
    await user.tab();

    // A number with no country code is only dialable from inside the country
    // that issued it, which is not what writing it down here is for.
    expect(
      await screen.findByText(/Write the number with its country code/),
    ).toBeInTheDocument();
    expect(setPayoutMethodsAction).not.toHaveBeenCalled();
  });

  it("stops complaining as the mistake is fixed, having complained once", async () => {
    const { user } = renderCard([{ method: "bank", detail: "" }]);

    const field = screen.getByLabelText("IBAN");
    await user.type(field, "CH93 0076 2011 6238 5295");
    await user.tab();
    expect(await screen.findByText(/does not check out/)).toBeInTheDocument();

    await user.type(field, "7");

    // Live from here on: somebody who has been told what is wrong wants to
    // watch it come right, rather than tab away to find out.
    await waitFor(() =>
      expect(screen.queryByText(/does not check out/)).not.toBeInTheDocument(),
    );
  });

  it("puts the list back when the write is refused", async () => {
    const { user } = renderCard([BANK, TWINT]);
    setPayoutMethodsAction.mockResolvedValue({ ok: false, error: "Nope." });

    await user.click(screen.getByRole("button", { name: "Remove TWINT" }));

    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    // Still two rows: the row that vanished has come back, because it never
    // actually went anywhere.
    expect(screen.getByRole("button", { name: "Remove TWINT" })).toBeVisible();
    expect(toastUndoable).not.toHaveBeenCalled();
  });

  it("rolls back to what was last written, not to what the page loaded with", async () => {
    const { user } = renderCard([BANK]);

    // Saved: cash needs nothing typed, so it is a complete fact at once.
    await user.click(screen.getByRole("button", { name: /Add a method/ }));
    const sheet = within(await screen.findByRole("dialog"));
    // Exact: "Cash App" is a different row, one slot away in the same list.
    await user.click(sheet.getByRole("button", { name: "Cash" }));
    await waitFor(() => expect(written()).toEqual(["bank", "cash"]));

    setPayoutMethodsAction.mockResolvedValue({ ok: false, error: "Nope." });
    await user.click(screen.getByRole("button", { name: "Remove Cash" }));

    // The cash that was already stored comes back. Rolling back to the list
    // the page loaded with would silently drop it.
    expect(await screen.findByText("Nope.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Cash" })).toBeVisible();
  });

  it("waits for a Swiss IBAN before asking where you live", async () => {
    const { user } = renderCard([{ method: "bank", detail: "" }]);

    // An empty IBAN is not a Swiss one. Five address fields under it are five
    // questions asked of a country that has not been named yet.
    expect(
      screen.queryByText("Address for the Swiss QR-bill"),
    ).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("IBAN"), "CH9300762011623852957");

    expect(
      await screen.findByText("Address for the Swiss QR-bill"),
    ).toBeInTheDocument();
    expect(screen.getByText("To complete")).toBeInTheDocument();
  });

  it("says a half-filled address is half-filled, rather than writing nothing", async () => {
    const { user } = renderCard([BANK]);

    // A postcode and no town: short of what the standard needs, so nothing is
    // written — and somebody told nothing concludes the QR code is broken.
    await user.type(screen.getByLabelText("Postcode"), "3920");
    await user.tab();

    expect(
      await screen.findByText(/at least a postcode, a town/),
    ).toBeInTheDocument();
    expect(setPayoutAddressAction).not.toHaveBeenCalled();
  });

  it("reports a refused address instead of dropping it", async () => {
    const { user } = renderCard([BANK]);
    setPayoutAddressAction.mockResolvedValue({ ok: false, error: "Nope." });

    await user.type(screen.getByLabelText("Postcode"), "3920");
    await user.type(screen.getByLabelText("Town"), "Zermatt");
    await user.type(screen.getByLabelText("Country"), "CH");
    await user.tab();

    expect(await screen.findByText("Nope.")).toBeInTheDocument();
  });

  it("keeps the country to the two letters that travel in the code", async () => {
    const { user } = renderCard([BANK]);

    // A box that accepted "Suisse" was a box that took an answer, kept it on
    // screen and never wrote it.
    const country = screen.getByLabelText("Country");
    await user.type(country, "ch");
    expect(country).toHaveValue("CH");
    expect(country).toHaveAttribute("maxlength", "2");
  });

  it("stops asking once the IBAN is somebody else's country", async () => {
    const { user } = renderCard([BANK]);

    await user.clear(screen.getByLabelText("IBAN"));
    await user.type(screen.getByLabelText("IBAN"), "DE89370400440532013000");

    // A German account gets a Girocode, which carries no address at all.
    await waitFor(() =>
      expect(
        screen.queryByText("Address for the Swiss QR-bill"),
      ).not.toBeInTheDocument(),
    );
  });

  it("offers the whole catalogue, and marks what is already on the list", async () => {
    const { user } = renderCard([TWINT]);

    await user.click(screen.getByRole("button", { name: /Add a method/ }));

    const sheet = within(await screen.findByRole("dialog"));
    // Already added: still shown, so nobody wonders where it went, but inert.
    expect(sheet.getByRole("button", { name: /TWINT/ })).toBeDisabled();
    expect(sheet.getByRole("button", { name: /PayPal/ })).toBeEnabled();
  });

  it("takes a method nobody listed, exactly as it was typed", async () => {
    const { user } = renderCard();

    await user.click(screen.getByRole("button", { name: /Add a method/ }));
    const sheet = within(await screen.findByRole("dialog"));
    await user.type(
      sheet.getByLabelText("Search payment methods"),
      "Postfinance",
    );

    // The catalogue decides what is offered, never what is allowed.
    await user.click(
      await sheet.findByRole("button", { name: /Use “Postfinance”/ }),
    );

    expect(await screen.findByText("Postfinance")).toBeInTheDocument();
  });

  it("names the identifier the way the method's own app names it", async () => {
    const { user } = renderCard([{ method: "revolut", detail: "" }]);

    // "Your handle there" is what the field's *kind* is called; Revolut calls
    // it a Revtag, and so does the person reading it off their phone.
    expect(screen.getByLabelText("Revtag")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove Revolut" }));
  });
});
