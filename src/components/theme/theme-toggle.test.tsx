import { beforeEach, describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ThemeToggle } from "./theme-toggle";

/**
 * jsdom has no View Transition API, so `useModeAnimation` takes its documented
 * fallback path and switches instantly. That is exactly the path a reduced
 * motion user gets, and it still has to move the preference — which is what
 * these assertions are about.
 *
 * The `matchMedia` stub reports no dark preference, so "Auto" resolves light
 * throughout and the trigger starts on the sun.
 */
const STORAGE_KEY = "balancia-theme";

function renderToggle() {
  return renderWithIntl(
    // The provider is configured as `providers.tsx` configures it, storage key
    // included. On the default key the animation hook's own
    // `localStorage.theme` write lands on top of the provider's record, and a
    // test that let it would be testing a collision the app does not have.
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      storageKey={STORAGE_KEY}
    >
      <ThemeToggle />
    </ThemeProvider>,
  );
}

async function openMenu(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: /^Theme: /, hidden: false }),
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("starts on the device's choice and says so", async () => {
    renderToggle();

    expect(
      await screen.findByRole("button", { name: "Theme: Auto" }),
    ).toBeEnabled();
  });

  it("offers all three choices with the active one checked", async () => {
    const user = userEvent.setup();
    renderToggle();
    await openMenu(user);

    expect(
      await screen.findByRole("menuitemradio", { name: "Auto" }),
    ).toBeChecked();
    expect(
      screen.getByRole("menuitemradio", { name: "Light" }),
    ).not.toBeChecked();
    expect(
      screen.getByRole("menuitemradio", { name: "Dark" }),
    ).not.toBeChecked();
  });

  it("switches to dark and relabels itself", async () => {
    const user = userEvent.setup();
    renderToggle();
    await openMenu(user);

    await user.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );

    expect(
      await screen.findByRole("button", { name: "Theme: Dark" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("goes back to following the device", async () => {
    const user = userEvent.setup();
    renderToggle();
    await openMenu(user);
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Dark" }),
    );

    await openMenu(user);
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Auto" }),
    );

    expect(
      await screen.findByRole("button", { name: "Theme: Auto" }),
    ).toBeInTheDocument();
    expect(document.documentElement).not.toHaveClass("dark");
    // The point of the choice: it is the device's answer that is stored, not
    // the light it happens to resolve to today.
    expect(localStorage.getItem(STORAGE_KEY)).toBe("system");
  });
});
