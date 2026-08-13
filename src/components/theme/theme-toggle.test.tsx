import { beforeEach, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "next-themes";
import { ThemeToggle } from "./theme-toggle";

/**
 * jsdom has no View Transition API, so `useModeAnimation` takes its documented
 * fallback path and switches instantly. That is exactly the path a reduced
 * motion user gets, and it still has to move the preference — which is what
 * these assertions are about.
 */
function renderToggle() {
  return render(
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

describe("ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.className = "";
  });

  it("starts from the resolved theme — light, since the matchMedia stub reports no dark preference", async () => {
    renderToggle();

    expect(
      await screen.findByRole("button", { name: "Switch to dark theme" }),
    ).toBeEnabled();
  });

  it("switches to dark and relabels itself", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(
      await screen.findByRole("button", { name: "Switch to dark theme" }),
    );

    expect(
      await screen.findByRole("button", { name: "Switch to light theme" }),
    ).toBeInTheDocument();
    expect(document.documentElement).toHaveClass("dark");
  });

  it("switches back to light", async () => {
    const user = userEvent.setup();
    renderToggle();

    await user.click(
      await screen.findByRole("button", { name: "Switch to dark theme" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Switch to light theme" }),
    );

    expect(document.documentElement).not.toHaveClass("dark");
  });
});
