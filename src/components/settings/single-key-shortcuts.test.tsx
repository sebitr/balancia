import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * The "Single-key shortcuts" switch: per device, from `lg` up, and silent.
 *
 * The toast module is stubbed only to prove it is never called — the switch
 * is a control that flicks back, and says it for itself (AGENTS.md).
 */
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { SingleKeyShortcuts } = await import("./single-key-shortcuts");
const { readSingleKeys } = await import("@/components/layout/single-keys");

afterEach(() => {
  document.cookie = "balancia_single_keys=; path=/; max-age=0";
  toast.success.mockClear();
});

describe("SingleKeyShortcuts", () => {
  it("is on by default, says what N and S do, and is only drawn from lg up", () => {
    const { container } = renderWithIntl(<SingleKeyShortcuts initialOn />);

    const toggle = screen.getByRole("switch", { name: "Single-key shortcuts" });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText(
        "N adds an expense and S settles up when no field has the cursor. Stays on this device.",
      ),
    ).toBeInTheDocument();
    expect(container.firstElementChild).toHaveClass("hidden", "lg:block");
  });

  it("turns them off and on again for this device, in silence", async () => {
    renderWithIntl(<SingleKeyShortcuts initialOn />);
    const toggle = screen.getByRole("switch", { name: "Single-key shortcuts" });

    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(document.cookie).toContain("balancia_single_keys=off");
    expect(readSingleKeys()).toBe(false);

    await userEvent.click(toggle);
    expect(toggle).toBeChecked();
    expect(document.cookie).not.toContain("balancia_single_keys=off");
    expect(readSingleKeys()).toBe(true);

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("draws the device's choice as it stands", () => {
    renderWithIntl(<SingleKeyShortcuts initialOn={false} />);
    expect(
      screen.getByRole("switch", { name: "Single-key shortcuts" }),
    ).not.toBeChecked();
  });

  it("is in French where the reader reads French", () => {
    renderWithIntl(<SingleKeyShortcuts initialOn />, { locale: "fr" });
    expect(
      screen.getByRole("switch", { name: "Raccourcis à une touche" }),
    ).toBeInTheDocument();
  });
});
