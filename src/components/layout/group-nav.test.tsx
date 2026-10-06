import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
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

const { GroupNav, GroupRail } = await import("./group-nav");

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
    expect(directionFrom("/groups/g1", "Transactions")).toBe("switch-forward");
    expect(directionFrom("/groups/g1", "Settings")).toBe("switch-forward");
  });

  it("slides back towards a tab nearer the start", () => {
    expect(directionFrom("/groups/g1/settings", "Overview")).toBe(
      "switch-back",
    );
    expect(directionFrom("/groups/g1/members", "Transactions")).toBe(
      "switch-back",
    );
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
    // /expenses/new sits under both "Transactions" and "Add"; the longer href
    // wins, so leaving it moves back down the bar rather than forward.
    expect(directionFrom("/groups/g1/expenses/new", "Transactions")).toBe(
      "switch-back",
    );
    expect(directionFrom("/groups/g1/expenses/new", "Settings")).toBe(
      "switch-forward",
    );
  });

  /**
   * A repayment is stored in its own table and so lives at its own path, but
   * the reader reached it from the transactions list and has not gone
   * anywhere else. Expenses stays lit, and stays the tab a sideways move is
   * measured from.
   */
  it("keeps Expenses lit on a repayment, which is one of its rows", () => {
    cleanup();
    nav.pathname = "/groups/g1/settlements/s1";
    renderWithIntl(<GroupNav groupId="g1" />);
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(directionFrom("/groups/g1/settlements/s1", "Settings")).toBe(
      "switch-forward",
    );
    expect(directionFrom("/groups/g1/settlements/s1", "Overview")).toBe(
      "switch-back",
    );
    // Editing one opens a drawer over it, and does not leave the section.
    expect(directionFrom("/groups/g1/settlements/s1/edit", "Overview")).toBe(
      "switch-back",
    );
  });

  it("treats a tab as the way out of a screen that is on no tab at all", () => {
    for (const tab of ["Overview", "Transactions", "People", "Settings"]) {
      expect(directionFrom("/groups/g1/settle", tab)).toBe("pop");
    }
    expect(directionFrom("/groups/g1/activity", "Overview")).toBe("pop");
  });
});

/**
 * The rail a desktop window gets from `lg` up, in place of the bar.
 *
 * It is the same navigation drawn down the side, so what is pinned here is
 * that it says the same things: one landmark under the same name, the same
 * five links under the same names, the current one marked the same way, and
 * the same motion on every tap.
 */
describe("GroupRail", () => {
  function renderRail(pathname: string) {
    cleanup();
    nav.pathname = pathname;
    renderWithIntl(<GroupRail groupId="g1" />);
    return screen.getByRole("navigation", { name: "Group sections" });
  }

  it("is one landmark holding Add and the four places, with where you are marked", () => {
    const rail = renderRail("/groups/g1/members");

    const links = within(rail).getAllByRole("link");
    // Add heads the rail as its one filled button; the places follow in the
    // bar's own order.
    expect(links.map((link) => link.textContent)).toEqual([
      "Add",
      "Overview",
      "Transactions",
      "People",
      "Settings",
    ]);
    expect(within(rail).getByRole("link", { name: "People" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(links.filter((link) => link.hasAttribute("aria-current"))).toEqual([
      within(rail).getByRole("link", { name: "People" }),
    ]);
    expect(within(rail).getByRole("link", { name: "Add" })).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new",
    );
  });

  it("moves the screen exactly as the bar would, from wherever it is", () => {
    for (const pathname of [
      "/groups/g1",
      "/groups/g1/members",
      "/groups/g1/settlements/s1",
      "/groups/g1/settle",
    ]) {
      for (const tab of ["Overview", "Transactions", "Add", "People"]) {
        const rail = renderRail(pathname);
        const fromRail = within(rail)
          .getByRole("link", { name: tab })
          .getAttribute("data-transition");
        expect(fromRail, `${tab} from ${pathname}`).toBe(
          directionFrom(pathname, tab),
        );
      }
    }
  });
});

/**
 * The bar and the rail are both in the document at every width, and CSS shows
 * one of them: `lg:hidden` on the bar, `hidden lg:flex` on the rail. What
 * matters is the accessibility tree, where `display: none` is the difference
 * between one navigation and two copies of it.
 *
 * jsdom applies no Tailwind and no media queries, so each width is stood in
 * for by the rules Tailwind emits there, in the order it emits them — the
 * `lg:` variants after the base utilities they override.
 */
describe("the bar and the rail together", () => {
  const WIDTHS = [
    ["a phone", ".hidden { display: none; }", "app-nav"],
    [
      "a desktop",
      ".hidden { display: none; } .lg\\:flex { display: flex; } .lg\\:hidden { display: none; }",
      "app-rail-nav",
    ],
  ] as const;

  // The control: with no rules at all, both are there to be found. So the
  // single landmark below is the stylesheet's doing, not the markup's.
  it("are both in the document, for CSS to choose between", () => {
    cleanup();
    nav.pathname = "/groups/g1";
    renderWithIntl(
      <>
        <GroupRail groupId="g1" />
        <GroupNav groupId="g1" />
      </>,
    );
    expect(
      screen.getAllByRole("navigation", { name: "Group sections" }),
    ).toHaveLength(2);
  });

  it.each(WIDTHS)(
    "expose exactly one group navigation on %s",
    (_width, css, shown) => {
      cleanup();
      nav.pathname = "/groups/g1";
      const sheet = document.createElement("style");
      sheet.textContent = css;
      document.head.append(sheet);

      try {
        renderWithIntl(
          <>
            <GroupRail groupId="g1" />
            <GroupNav groupId="g1" />
          </>,
        );

        const exposed = screen.getAllByRole("navigation", {
          name: "Group sections",
        });
        expect(exposed).toHaveLength(1);
        expect(exposed[0]).toHaveAttribute("data-slot", shown);
        // And so one link to each place, not two.
        expect(screen.getAllByRole("link", { name: "Overview" })).toHaveLength(
          1,
        );
      } finally {
        sheet.remove();
      }
    },
  );
});
