import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { DEFAULT_SURFACES } from "@/modules/profile/surface";
import { SurfaceChoices } from "./surface-choices";

/**
 * The surfaces and the contrast, and the one thing about them that is not
 * obvious: they reach the page as attributes on the document root, which the
 * server writes — so the tap has to put the attribute there before the
 * write, and a refused write has to take it back.
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
  for (const name of ["data-light", "data-dark", "data-contrast"]) {
    root().removeAttribute(name);
  }
  const view = renderWithIntl(<SurfaceChoices current={current} />);
  return { ...view, user: userEvent.setup() };
}

beforeEach(() => {
  // jsdom has no matchMedia; "Auto" contrast asks it what the system wants.
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
});

describe("SurfaceChoices", () => {
  it("paints the surface on the root before it writes", async () => {
    const { user } = renderChoices();
    setSurfaceAction.mockReturnValue(new Promise(() => {}));

    await user.click(screen.getByRole("radio", { name: /^Paper/ }));

    expect(root().getAttribute("data-light")).toBe("paper");
  });

  it("writes only the field that changed", async () => {
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: /^Midnight/ }));

    await waitFor(() =>
      expect(setSurfaceAction).toHaveBeenCalledWith({ dark: "midnight" }),
    );
    expect(root().getAttribute("data-dark")).toBe("midnight");
    expect(root().hasAttribute("data-light")).toBe(false);
  });

  it("removes the attribute for a default, so the document is as the server would render it", async () => {
    const { user } = renderChoices({ ...DEFAULT_SURFACES, light: "paper" });
    root().setAttribute("data-light", "paper");

    await user.click(screen.getByRole("radio", { name: /^Cream/ }));

    expect(root().hasAttribute("data-light")).toBe(false);
  });

  it("takes the surface back when the write is refused", async () => {
    const { user } = renderChoices();
    setSurfaceAction.mockResolvedValue({ ok: false });

    await user.click(screen.getByRole("radio", { name: /^Paper/ }));

    await waitFor(() => expect(root().hasAttribute("data-light")).toBe(false));
    expect(toastError).toHaveBeenCalled();
  });

  it("sets and clears the contrast attribute, asking the system on Auto", async () => {
    const { user } = renderChoices();
    // "Auto" is also the first theme card, so the query is scoped.
    const contrast = within(
      screen.getByRole("radiogroup", { name: "Contrast" }),
    );

    await user.click(contrast.getByRole("radio", { name: /^Increased/ }));
    expect(root().getAttribute("data-contrast")).toBe("more");

    await user.click(contrast.getByRole("radio", { name: /^Standard/ }));
    expect(root().getAttribute("data-contrast")).toBe("standard");

    await user.click(contrast.getByRole("radio", { name: /^Auto/ }));
    expect(root().hasAttribute("data-contrast")).toBe(false);
  });

  it("describes the Light theme card by the surface chosen for it", async () => {
    const { user } = renderChoices();

    await user.click(screen.getByRole("radio", { name: /^Paper/ }));

    const theme = within(screen.getByRole("radiogroup", { name: "Theme" }));
    expect(
      theme.getByRole("radio", { name: /^Light.*Pure white, cooler/ }),
    ).toBeInTheDocument();
  });
});
