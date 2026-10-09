import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { CopyAddress } from "./copy-address";

/**
 * The address every assistant needs, and the button that copies it.
 *
 * The confirmation is the button changing, not a toast: the control moved and
 * stayed moved, which is the whole of what a toast would have said.
 */

const { toastSuccess } = vi.hoisted(() => ({ toastSuccess: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: toastSuccess } }));

const ADDRESS = "https://balancia.example/mcp";

describe("CopyAddress", () => {
  it("gives the address, ready to select and not to edit", () => {
    renderWithIntl(<CopyAddress address={ADDRESS} />);

    const field = screen.getByLabelText("Balancia’s address for assistants");
    expect(field).toHaveValue(ADDRESS);
    expect(field).toHaveAttribute("readonly");
  });

  it("copies the address, and says so on the button rather than in a toast", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CopyAddress address={ADDRESS} />);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await user.click(screen.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ADDRESS));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("leaves the address selectable when the browser refuses the clipboard", async () => {
    const user = userEvent.setup();
    renderWithIntl(<CopyAddress address={ADDRESS} />);
    const writeText = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    await user.click(screen.getByRole("button", { name: "Copy address" }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    // No false "Copied", and nothing thrown at the reader.
    expect(screen.queryByText("Copied")).not.toBeInTheDocument();
    expect(
      screen.getByLabelText("Balancia’s address for assistants"),
    ).toHaveValue(ADDRESS);
  });

  it("is written in French in French", () => {
    renderWithIntl(<CopyAddress address={ADDRESS} />, { locale: "fr" });

    expect(
      screen.getByRole("button", { name: "Copier l’adresse" }),
    ).toBeInTheDocument();
  });
});
