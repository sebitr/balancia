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

const { GroupNav, GroupTabs } = await import("./group-nav");
const { GroupHeader } = await import("./group-header");

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
 * The tabs a desktop window gets from `lg` up, in the group's header, in place
 * of the bar.
 *
 * They are the same navigation drawn across the top, so what is pinned here
 * is that they say the same things: one landmark under the same name, the
 * four places under the same names, the current one marked the same way, and
 * the same motion on every tap. Add is not among them: from `lg` up it is the
 * sidebar's filled button.
 */
describe("GroupTabs", () => {
  function renderTabs(pathname: string) {
    cleanup();
    nav.pathname = pathname;
    renderWithIntl(<GroupTabs groupId="g1" />);
    return screen.getByRole("navigation", { name: "Group sections" });
  }

  it("is one landmark holding the four places, with where you are marked", () => {
    const tabs = renderTabs("/groups/g1/members");

    const links = within(tabs).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Overview",
      "Transactions",
      "People",
      "Settings",
    ]);
    expect(links.filter((link) => link.hasAttribute("aria-current"))).toEqual([
      within(tabs).getByRole("link", { name: "People" }),
    ]);
    expect(within(tabs).getByRole("link", { name: "People" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(within(tabs).queryByRole("link", { name: "Add" })).toBeNull();
  });

  it("moves the screen exactly as the bar would, from wherever it is", () => {
    for (const pathname of [
      "/groups/g1",
      "/groups/g1/members",
      "/groups/g1/settlements/s1",
      "/groups/g1/settle",
    ]) {
      for (const tab of ["Overview", "Transactions", "People", "Settings"]) {
        const tabs = renderTabs(pathname);
        const fromTabs = within(tabs)
          .getByRole("link", { name: tab })
          .getAttribute("data-transition");
        expect(fromTabs, `${tab} from ${pathname}`).toBe(
          directionFrom(pathname, tab),
        );
      }
    }
  });
});

/**
 * The bar and the tabs are both in the document at every width, and CSS shows
 * one of them: `lg:hidden` on the bar, `hidden lg:block` on the tabs. What
 * matters is the accessibility tree, where `display: none` is the difference
 * between one navigation and two copies of it.
 *
 * jsdom applies no Tailwind and no media queries, so each width is stood in
 * for by the rules Tailwind emits there, in the order it emits them — the
 * `lg:` variants after the base utilities they override.
 */
describe("the bar and the tabs together", () => {
  const PHONE = ".hidden { display: none; }";
  const DESK =
    ".hidden { display: none; } .lg\\:flex { display: flex; } .lg\\:block { display: block; } .lg\\:hidden { display: none; }";
  const WIDTHS = [
    ["a phone", PHONE, "app-nav"],
    ["a desktop", DESK, "app-group-tabs"],
  ] as const;

  /** A group's screen as the layout draws it: the header, then the bar. */
  function renderGroup(pathname: string, css?: string) {
    cleanup();
    nav.pathname = pathname;
    const sheet = document.createElement("style");
    if (css) {
      sheet.textContent = css;
      document.head.append(sheet);
    }
    renderWithIntl(
      <>
        <GroupHeader groupId="g1">
          <p>Lisbon, March</p>
        </GroupHeader>
        <GroupNav groupId="g1" />
      </>,
    );
    return () => sheet.remove();
  }

  // The control: with no rules at all, both are there to be found. So the
  // single landmark below is the stylesheet's doing, not the markup's.
  it("are both in the document, for CSS to choose between", () => {
    const done = renderGroup("/groups/g1");
    try {
      expect(
        screen.getAllByRole("navigation", { name: "Group sections" }),
      ).toHaveLength(2);
    } finally {
      done();
    }
  });

  it.each(WIDTHS)(
    "expose exactly one group navigation on %s",
    (_width, css, shown) => {
      for (const pathname of [
        "/groups/g1",
        "/groups/g1/expenses",
        "/groups/g1/members",
        "/groups/g1/settings",
      ]) {
        const done = renderGroup(pathname, css);
        try {
          const exposed = screen.getAllByRole("navigation", {
            name: "Group sections",
          });
          expect(exposed, pathname).toHaveLength(1);
          expect(exposed[0]).toHaveAttribute("data-slot", shown);
          // And so one link to each place, not two.
          expect(
            screen.getAllByRole("link", { name: "Overview" }),
          ).toHaveLength(1);
        } finally {
          done();
        }
      }
    },
  );

  /**
   * A screen reached by a push opens on its own way back, as it does on a
   * phone, so the header and its tabs are not drawn there at all. The bar is
   * untouched by this: below `lg` it is still on every screen of the group.
   */
  it("drops the header and its tabs on a screen reached by a push", () => {
    for (const pathname of [
      "/groups/g1/expenses/e1",
      "/groups/g1/settle",
      "/groups/g1/members/p1",
      "/groups/g1/stats",
    ]) {
      const done = renderGroup(pathname, DESK);
      try {
        expect(
          document.querySelector("[data-slot=group-header]"),
          pathname,
        ).toBeNull();
        expect(
          screen.queryAllByRole("navigation", { name: "Group sections" }),
          pathname,
        ).toHaveLength(0);
      } finally {
        done();
      }

      const phone = renderGroup(pathname, PHONE);
      try {
        expect(
          screen.getAllByRole("navigation", { name: "Group sections" }),
          pathname,
        ).toHaveLength(1);
      } finally {
        phone();
      }
    }
  });

  /**
   * The entry drawer opens over the screen it was opened from, and the
   * address changes to the drawer's. The screen under it is still the
   * transactions, so their header — and the tabs that say where the reader
   * is — stay drawn under the drawer rather than vanishing behind it.
   */
  it("keeps the header under the entry drawer opened from a tab", () => {
    cleanup();
    nav.pathname = "/groups/g1/expenses";
    const group = (
      <GroupHeader groupId="g1">
        <p>Lisbon, March</p>
      </GroupHeader>
    );
    const { rerender } = renderWithIntl(group);
    expect(document.querySelector("[data-slot=group-header]")).not.toBeNull();

    nav.pathname = "/groups/g1/expenses/new";
    rerender(
      <GroupHeader groupId="g1">
        <p>Lisbon, March</p>
      </GroupHeader>,
    );
    expect(document.querySelector("[data-slot=group-header]")).not.toBeNull();
    expect(screen.getByRole("link", { name: "Transactions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });
});
