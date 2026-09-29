import { existsSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderToStaticMarkup } from "react-dom/server";
import { renderWithIntl } from "../../tests/helpers/intl";
import GlobalError from "./global-error";
import GroupError from "./groups/[groupId]/error";
import SettingsError from "./settings/error";

/**
 * Where a failure is caught, and what the reader is left holding.
 *
 * There was one boundary, at the root, which owns the whole screen — so a
 * group whose balances failed to load lost its header and its tab bar along
 * with the overview, and settings lost the only header it has. And there was
 * none above the root layout, whose throws reached Next's built-in page,
 * unstyled and in English.
 */

const pathname = vi.hoisted(() => ({ current: "/settings" }));
vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
}));

const failure = Object.assign(new Error("boom"), { digest: "4096" });

// Each boundary logs the error it caught, which is noise in a test's output.
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the group's error boundary", () => {
  it("says what happened, with its reference, and tries again", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const retry = vi.fn();
    const user = userEvent.setup();
    renderWithIntl(<GroupError error={failure} retry={retry} />);

    expect(
      screen.getByRole("heading", { name: "Something went wrong" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Reference: 4096")).toBeInTheDocument();
    // The message is never shown: it can carry internals.
    expect(screen.queryByText(/boom/)).toBeNull();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});

describe("the settings error boundary", () => {
  it("keeps the hub's way out of settings", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pathname.current = "/settings";
    renderWithIntl(<SettingsError error={failure} retry={vi.fn()} />);

    // Named once, by the settings header, not twice.
    expect(
      screen.getAllByRole("heading", { name: "Something went wrong" }),
    ).toHaveLength(1);
    expect(
      screen.getByRole("link", { name: "Close settings" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("keeps a screen's way back to the hub", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pathname.current = "/settings/money";
    renderWithIntl(<SettingsError error={failure} retry={vi.fn()} />);

    expect(
      screen.getByRole("link", { name: "Back to settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  /** A route with no loading boundary cannot be prefetched at all. */
  it("has a loading boundary beside it", () => {
    expect(
      existsSync(join(process.cwd(), "src", "app", "settings", "loading.tsx")),
    ).toBe(true);
  });
});

describe("the page above the root layout", () => {
  /**
   * It renders the only `<html>` there is, so it is checked as markup rather
   * than mounted inside the test's own document.
   */
  it("speaks both of the app's languages, and marks the French as French", () => {
    const markup = renderToStaticMarkup(
      <GlobalError error={failure} retry={vi.fn()} />,
    );

    expect(markup).toContain('<html lang="en">');
    expect(markup).toContain("Something went wrong");
    expect(markup).toContain('<span lang="fr">Une erreur est survenue</span>');
    expect(markup).toContain("Try again");
    expect(markup).toContain('<span lang="fr">Réessayer</span>');
    expect(markup).toContain("4096");
    expect(markup).not.toContain("boom");
  });
});
