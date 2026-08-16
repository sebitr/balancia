import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * Which way a tab moves the screen is the subject here, and `transitionTypes`
 * is a router concern that leaves no trace in the DOM. Link is swapped for a
 * plain anchor that writes it to an attribute, so the direction each tab
 * carries can be read back.
 */
const nav = vi.hoisted(() => ({ pathname: "" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
  }) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>
      {children}
    </a>
  ),
}));

const { GroupNav } = await import("./group-nav");

/**
 * The direction the named tab would carry, standing on `pathname`.
 *
 * Several of these run inside one test, and the automatic cleanup only fires
 * between tests, so each call clears the last bar out of the document first.
 */
function directionFrom(pathname: string, tab: string): string | null {
  cleanup();
  nav.pathname = pathname;
  renderWithIntl(<GroupNav groupId="g1" />);
  return screen
    .getByRole("link", { name: tab })
    .getAttribute("data-transition");
}

describe("GroupNav", () => {
  it("slides forward towards a tab further along the bar", () => {
    expect(directionFrom("/groups/g1", "Expenses")).toBe("switch-forward");
    expect(directionFrom("/groups/g1", "Settings")).toBe("switch-forward");
  });

  it("slides back towards a tab nearer the start", () => {
    expect(directionFrom("/groups/g1/settings", "Overview")).toBe(
      "switch-back",
    );
    expect(directionFrom("/groups/g1/members", "Expenses")).toBe("switch-back");
  });

  it("reads direction from the tab being left, not from the one tapped", () => {
    expect(directionFrom("/groups/g1", "Settings")).toBe("switch-forward");
    expect(directionFrom("/groups/g1/members", "Settings")).toBe(
      "switch-forward",
    );
    expect(directionFrom("/groups/g1/settings", "Settings")).toBe(
      "switch-back",
    );
  });

  /**
   * Add opens a drawer over the screen it was tapped from, and a drawer is
   * not a navigation: the screen underneath must not move at all, in either
   * direction, so the link carries no type for `<Screen>` to animate.
   */
  it("moves the screen in no direction at all for Add", () => {
    expect(directionFrom("/groups/g1", "Add")).toBeNull();
    expect(directionFrom("/groups/g1/settings", "Add")).toBeNull();
  });

  it("resolves the current tab by the most specific match", () => {
    // /expenses/new sits under both "Expenses" and "Add"; the longer href
    // wins, so leaving it moves back down the bar rather than forward.
    expect(directionFrom("/groups/g1/expenses/new", "Expenses")).toBe(
      "switch-back",
    );
    expect(directionFrom("/groups/g1/expenses/new", "Settings")).toBe(
      "switch-forward",
    );
  });

  it("treats a tab as the way out of a screen that is on no tab at all", () => {
    for (const tab of ["Overview", "Expenses", "People", "Settings"]) {
      expect(directionFrom("/groups/g1/balances", tab)).toBe("pop");
    }
    expect(directionFrom("/groups/g1/activity", "Overview")).toBe("pop");
  });
});
