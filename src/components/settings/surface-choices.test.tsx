import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { DEFAULT_SURFACES } from "@/modules/profile/surface";
import { SurfaceChoices } from "./surface-choices";

/**
 * The dark surface, and the one thing about it that is not obvious: it
 * reaches the page as an attribute on the document root, which the server
 * writes — so the tap has to put the attribute there before the write, and a
 * refused write has to take it back.
 *
 * There is nothing here about contrast any more. It follows
 * `prefers-contrast: more` from a media query, so no control sets it and no
 * script has to be stubbed to test one.
 */

const { setSurfaceAction, toastError } = vi.hoisted(() => ({
  setSurfaceAction: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/modules/profile/actions", () => ({ setSurfaceAction }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const root = () => document.documentElement;

function renderChoices(current = DEFAULT_SURFACES) {
  setSurfaceAction.mockReset();
  setSurfaceAction.mockResolvedValue({ ok: true });
  toastError.mockReset();
  root().removeAttribute("data-dark");
  const view = renderWithIntl(<SurfaceChoices current={current} />);
  return { ...view, user: userEvent.setup() };
}

describe("SurfaceChoices", () => {
  it("paints the surface on the root before it writes", async () => {
    const { user } = renderChoices();
    setSurfaceAction.mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByRole("radio", { name: /^Midnight/ }));

    expect(root().getAttribute("data-dark")).toBe("midnight");
  });

  it("writes the field that changed", async () => {
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: /^Midnight/ }));

    await waitFor(() =>
      expect(setSurfaceAction).toHaveBeenCalledWith({ dark: "midnight" }),
    );
    expect(root().getAttribute("data-dark")).toBe("midnight");
  });

  it("removes the attribute for the default, so the document is as the server would render it", async () => {
    const { user } = renderChoices({ dark: "midnight" });
    root().setAttribute("data-dark", "midnight");

    await user.click(screen.getByRole("radio", { name: /^Plum/ }));

    expect(root().hasAttribute("data-dark")).toBe(false);
  });

  it("takes the surface back when the write is refused", async () => {
    const { user } = renderChoices();
    setSurfaceAction.mockResolvedValue({ ok: false });

    await user.click(screen.getByRole("radio", { name: /^Midnight/ }));

    await waitFor(() => expect(root().hasAttribute("data-dark")).toBe(false));
    expect(toastError).toHaveBeenCalled();
  });

  it("describes the Dark theme card by the surface chosen for it", async () => {
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: /^Midnight/ }));

    const theme = within(screen.getByRole("radiogroup", { name: "Theme" }));
    expect(
      theme.getByRole("radio", { name: /^Dark.*Near black, for OLED/ }),
    ).toBeInTheDocument();
  });

  it("describes the Light theme card by the only light palette there is", () => {
    renderChoices();

    const theme = within(screen.getByRole("radiogroup", { name: "Theme" }));
    expect(
      theme.getByRole("radio", { name: /^Light.*Warm paper, white cards/ }),
    ).toBeInTheDocument();
  });
});
