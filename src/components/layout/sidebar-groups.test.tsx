import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { NavigationGroup } from "@/modules/balances/navigation";

/**
 * The sidebar's list of groups: what each row says, which rows are folded
 * away, and what stands in while the list is on its way.
 */
const nav = vi.hoisted(() => ({
  pathname: "/dashboard",
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: nav.refresh }),
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

const { SidebarGroups, SidebarGroupsFallback } =
  await import("./sidebar-groups");
const { SidebarFrame } = await import("./sidebar-context");

function group(
  id: string,
  name: string,
  amounts: NavigationGroup["amounts"],
  direction: NavigationGroup["direction"],
): NavigationGroup {
  return {
    id,
    name,
    icon: null,
    iconColor: null,
    direction,
    amounts,
    lastActivityAt: "2026-08-12T10:00:00.000Z",
  };
}

const LISBON = group(
  "g1",
  "Lisbon, March",
  [
    { minorUnits: "24800", currency: "EUR" },
    { minorUnits: "-6220", currency: "CHF" },
  ],
  "owes",
);
const FLAT = group(
  "g2",
  "Flat 4B",
  [{ minorUnits: "-3680", currency: "EUR" }],
  "owes",
);
const BOOKS = group(
  "g3",
  "Book club",
  [{ minorUnits: "1250", currency: "EUR" }],
  "owed",
);
const PORTO = group("g4", "Porto, May", [], "settled");
const SKI = group("g5", "Ski 2025", [], "settled");

function renderList(
  groups: NavigationGroup[],
  {
    groupId = null,
    pathname = "/dashboard",
    collapsed = false,
    failed = false,
  }: {
    groupId?: string | null;
    pathname?: string;
    collapsed?: boolean;
    failed?: boolean;
  } = {},
) {
  cleanup();
  nav.pathname = pathname;
  document.cookie = collapsed
    ? "balancia_sidebar=collapsed; path=/"
    : "balancia_sidebar=; path=/; max-age=0";
  renderWithIntl(
    <SidebarFrame initialCollapsed={collapsed}>
      <SidebarGroups groups={groups} groupId={groupId} failed={failed} />
    </SidebarFrame>,
  );
}

describe("SidebarGroupsFallback", () => {
  // First in the file: nothing has been drawn on this "page" yet.
  it("draws placeholder rows before any list has arrived", () => {
    cleanup();
    renderWithIntl(<SidebarGroupsFallback groupId={null} />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("draws the last list instead, once there has been one", () => {
    renderList([LISBON, FLAT]);
    cleanup();
    renderWithIntl(<SidebarGroupsFallback groupId="g2" />);
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")),
    ).toEqual(["/groups/g1", "/groups/g2"]);
    expect(screen.getByRole("link", { name: /Flat 4B/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("SidebarGroups", () => {
  it("says where the reader stands in words, one line per currency", () => {
    renderList([LISBON, FLAT, BOOKS]);

    const lisbon = screen.getByRole("link", { name: /Lisbon, March/ });
    expect(within(lisbon).getByText("you are owed €248.00")).toHaveClass(
      "text-positive-ink",
    );
    expect(within(lisbon).getByText(/^you owe CHF\s62\.20$/)).toHaveClass(
      "text-negative-ink",
    );
    // No sign: the word carries the direction.
    expect(lisbon.textContent).not.toMatch(/[-−+]/);
    expect(
      within(screen.getByRole("link", { name: /Book club/ })).getByText(
        "you are owed €12.50",
      ),
    ).toHaveClass("text-positive-ink");
  });

  it("folds the settled groups behind one row", async () => {
    renderList([LISBON, BOOKS, PORTO, SKI]);

    expect(screen.getAllByRole("link").map((link) => link.textContent)).toEqual(
      [
        expect.stringContaining("Lisbon, March"),
        expect.stringContaining("Book club"),
      ],
    );
    const fold = screen.getByRole("button", { name: "Settled up · 2" });
    expect(fold).toHaveAttribute("aria-expanded", "false");

    await userEvent.click(fold);
    expect(fold).toHaveAttribute("aria-expanded", "true");
    const porto = screen.getByRole("link", { name: /Porto, May/ });
    expect(within(porto).getByText("settled")).toHaveClass(
      "text-neutral-balance-ink",
    );
  });

  it("never folds away the group being read", () => {
    renderList([LISBON, PORTO, SKI], {
      groupId: "g4",
      pathname: "/groups/g4/members",
    });

    const porto = screen.getByRole("link", { name: /Porto, May/ });
    expect(porto).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Settled up · 1" }),
    ).toBeInTheDocument();
  });

  it("keeps the section when moving across, and goes deeper from outside", () => {
    renderList([LISBON, FLAT], {
      groupId: "g1",
      pathname: "/groups/g1/members",
    });
    const flat = screen.getByRole("link", { name: /Flat 4B/ });
    expect(flat).toHaveAttribute("href", "/groups/g2/members");
    expect(flat).toHaveAttribute("data-transition", "switch-forward");

    renderList([LISBON, FLAT]);
    const fromHome = screen.getByRole("link", { name: /Flat 4B/ });
    expect(fromHome).toHaveAttribute("href", "/groups/g2");
    expect(fromHome).toHaveAttribute("data-transition", "push");
  });

  it("folded, keeps each tile's name and balance as its name", () => {
    renderList([LISBON], { collapsed: true });

    const lisbon = screen.getByRole("link", {
      name: /^Lisbon, March, you are owed €248\.00, you owe CHF\s62\.20$/,
    });
    // The tile is the only thing drawn; it says nothing about money.
    const tile = lisbon.querySelector("[data-slot=group-icon-tile]");
    expect(tile).not.toHaveClass("text-positive-ink");
    expect(tile).not.toHaveClass("text-negative-ink");
  });

  it("says so when there are no groups, or when they could not be read", async () => {
    renderList([]);
    expect(
      screen.getByText(/^No groups yet\. A group you create or join/),
    ).toBeInTheDocument();

    renderList([], { failed: true });
    await userEvent.click(
      screen.getByRole("button", { name: /Couldn't load your groups/ }),
    );
    expect(nav.refresh).toHaveBeenCalled();
  });
});
