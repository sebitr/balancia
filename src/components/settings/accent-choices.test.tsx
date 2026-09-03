import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { accentTokens } from "@/modules/profile/accent";
import { AccentChoices } from "./accent-choices";

const fillOf = (accent: Parameters<typeof accentTokens>[0]) =>
  accentTokens(accent)["--primary"];

/**
 * The accent, and the one thing about it that is not obvious.
 *
 * It reaches the app as `--primary` on the document root, which the server
 * sets — so the tap has to paint it before the write, or the swatch that was
 * just pressed keeps the old colour until the round trip finishes. A refused
 * write has to take the paint back with it, for the same reason every other
 * settings control puts itself back: an app in a colour the account did not
 * keep is a lie the next page load corrects.
 */

const { setAccentColorAction, toastError } = vi.hoisted(() => ({
  setAccentColorAction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/profile/actions", () => ({ setAccentColorAction }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

function renderChoices() {
  setAccentColorAction.mockReset();
  setAccentColorAction.mockResolvedValue({ ok: true });
  toastError.mockReset();
  document.documentElement.removeAttribute("style");
  const view = renderWithIntl(<AccentChoices current="coral" />);
  return { ...view, user: userEvent.setup() };
}

const painted = () =>
  document.documentElement.style.getPropertyValue("--primary");

describe("AccentChoices", () => {
  it("paints the root before it writes, and names what was chosen", async () => {
    // Never resolves, so nothing below can be the round trip having finished.
    const { user } = renderChoices();
    setAccentColorAction.mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByRole("radio", { name: "Mint" }));

    expect(painted()).toBe(fillOf("mint"));
    // The chosen colour names itself once, beside the section label.
    expect(screen.getByText("Mint")).toBeInTheDocument();
  });

  it("also paints the focus ring, so nothing is left the old colour", async () => {
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: "Ocean" }));

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--ring")).toBe(fillOf("ocean"));
    expect(style.getPropertyValue("--sidebar-primary")).toBe(fillOf("ocean"));
  });

  it("paints the money colours that step aside for the accent", async () => {
    // Mint sits on the "gets back" green, so that green moves; coral did not
    // ask it to. The link ink follows the accent too, per theme.
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: "Mint" }));

    const style = document.documentElement.style;
    expect(style.getPropertyValue("--accent-positive-dark")).toBe(
      accentTokens("mint")["--accent-positive-dark"],
    );
    expect(style.getPropertyValue("--accent-positive-dark")).not.toBe(
      accentTokens("coral")["--accent-positive-dark"],
    );
    expect(style.getPropertyValue("--accent-ink-light")).toBe(
      accentTokens("mint")["--accent-ink-light"],
    );
  });

  it("takes the colour back when the write is refused", async () => {
    const { user } = renderChoices();
    setAccentColorAction.mockResolvedValue({ ok: false });

    await user.click(screen.getByRole("radio", { name: "Raspberry" }));

    await waitFor(() => expect(painted()).toBe(fillOf("coral")));
    // Everything that moved comes back, the money colours included.
    expect(
      document.documentElement.style.getPropertyValue("--accent-negative-dark"),
    ).toBe(accentTokens("coral")["--accent-negative-dark"]);
    expect(screen.getByText("Coral")).toBeInTheDocument();
    expect(toastError).toHaveBeenCalled();
  });

  it("says nothing when it works: the app has already changed colour", async () => {
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: "Amber" }));

    await waitFor(() =>
      expect(setAccentColorAction).toHaveBeenCalledWith("amber"),
    );
    expect(toastError).not.toHaveBeenCalled();
  });
});
