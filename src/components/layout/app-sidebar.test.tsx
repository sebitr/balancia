import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { NavigationGroup } from "@/modules/balances/navigation";

/**
 * The desktop sidebar: what it holds for whom, how it folds, and what its
 * one filled button does in and out of a group.
 *
 * `Link` is a plain anchor that writes `transitionTypes` to an attribute, as
 * in `group-nav.test.tsx`. The toast module is stubbed only to prove it is
 * never called: folding the sidebar is a control that flicks back, and says
 * it for itself (AGENTS.md).
 */
const nav = vi.hoisted(() => ({ pathname: "/dashboard" }));

vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ refresh: vi.fn() }),
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

vi.mock("@/components/theme/theme-toggle", () => ({
  ThemeToggle: () => (
    <button type="button" aria-label="Theme">
      Theme
    </button>
  ),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { AppSidebar } = await import("./app-sidebar");
const { SidebarGroupAdd } = await import("./sidebar-group-add");
const { SidebarFrame } = await import("./sidebar-context");
const { SidebarGroups } = await import("./sidebar-groups");

const GROUPS: NavigationGroup[] = [
  {
    id: "g1",
    name: "Lisbon, March",
    icon: null,
    iconColor: null,
    direction: "owes",
    amounts: [
      { minorUnits: "24800", currency: "EUR" },
      { minorUnits: "-6220", currency: "CHF" },
    ],
    lastActivityAt: "2026-08-12T10:00:00.000Z",
  },
  {
    id: "g2",
    name: "Book club",
    icon: null,
    iconColor: null,
    direction: "owed",
    amounts: [{ minorUnits: "1250", currency: "EUR" }],
    lastActivityAt: "2026-08-11T10:00:00.000Z",
  },
];

afterEach(() => {
  document.cookie = "balancia_sidebar=; path=/; max-age=0";
  toast.success.mockClear();
});

function renderSidebar({
  isGuest = false,
  group = null,
  pathname = "/dashboard",
  collapsed = false,
  groups = GROUPS,
}: {
  isGuest?: boolean;
  group?: { id: string; name: string } | null;
  pathname?: string;
  collapsed?: boolean;
  groups?: NavigationGroup[];
} = {}) {
  cleanup();
  nav.pathname = pathname;
  // The device's cookie, which the server read into `initialCollapsed` and
  // the browser holds too.
  document.cookie = collapsed
    ? "balancia_sidebar=collapsed; path=/"
    : "balancia_sidebar=; path=/; max-age=0";
  renderWithIntl(
    <SidebarFrame initialCollapsed={collapsed}>
      <AppSidebar
        actor={{ label: isGuest ? "Tomás" : "Sébastien B.", isGuest }}
        group={group}
        // What the group layout hands the shell: the group's own Add.
        add={group ? <SidebarGroupAdd groupId={group.id} /> : undefined}
        notifications={
          isGuest ? undefined : <a href="/notifications">Notifications</a>
        }
        groups={
          isGuest ? undefined : (
            <SidebarGroups groups={groups} groupId={group?.id ?? null} />
          )
        }
        guestCard={isGuest ? <p>Keep Lisbon, March</p> : undefined}
      />
    </SidebarFrame>,
  );
  return screen.getByRole("banner");
}

describe("AppSidebar", () => {
  it("holds search, add, the places, the groups and the account", () => {
    const side = renderSidebar();

    expect(
      within(side).getByRole("link", { name: "Balancia home" }),
    ).toHaveAttribute("href", "/dashboard");
    // The palette is a later piece of work: the button is there, named, and
    // not yet pressable.
    const search = within(side).getByRole("button", {
      name: /Search or jump to/,
    });
    expect(search).toBeDisabled();
    expect(search).toHaveAttribute("data-shortcut", "mod+k");

    const places = within(side).getByRole("navigation", { name: "Balancia" });
    expect(
      within(places)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Home", "Notifications"]);
    expect(within(places).getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );

    expect(
      within(side).getByRole("link", { name: "New group" }),
    ).toHaveAttribute("href", "/dashboard?new");
    expect(
      within(side).getByRole("navigation", { name: "Your groups" }),
    ).toBeInTheDocument();
    expect(
      within(side).getByRole("link", { name: "Sébastien B., Settings" }),
    ).toHaveAttribute("href", "/settings");
  });

  it("asks which group to add to, outside a group", async () => {
    const side = renderSidebar();

    await userEvent.click(
      within(side).getByRole("button", { name: "Add expense" }),
    );
    const chooser = await screen.findByRole("dialog", {
      name: "Add to which group?",
    });
    // The chooser's own order, most recently active first.
    expect(
      within(chooser)
        .getAllByRole("link")
        .map((link) => link.getAttribute("href")),
    ).toEqual(["/groups/g1/expenses/new", "/groups/g2/expenses/new"]);
  });

  it("offers a group instead when there is none to add to", () => {
    const side = renderSidebar({ groups: [] });

    // Rendered once with the list to publish it, then read back.
    expect(
      within(side).queryByRole("button", { name: "Add expense" }),
    ).toBeNull();
    const links = within(side).getAllByRole("link", { name: "New group" });
    expect(links[0]).toHaveAttribute("href", "/dashboard?new");
    expect(
      within(side).getByText(/No groups yet\. A group you create or join/),
    ).toBeInTheDocument();
  });

  it("adds to the group being read, as the bar's own Add does", () => {
    const side = renderSidebar({
      group: { id: "g1", name: "Lisbon, March" },
      pathname: "/groups/g1/members",
    });

    const add = within(side).getByRole("link", { name: "Add expense" });
    expect(add).toHaveAttribute("href", "/groups/g1/expenses/new");
    // Into a drawer over the screen: no direction for the screen to move in.
    expect(add).not.toHaveAttribute("data-transition");
    // And out of the group is back up a level.
    expect(within(side).getByRole("link", { name: "Home" })).toHaveAttribute(
      "data-transition",
      "pop",
    );
  });

  it("folds to its icons and back, keeping every name, in silence", async () => {
    const side = renderSidebar({ group: { id: "g1", name: "Lisbon, March" } });
    const frame = document.querySelector("[data-slot=app-frame]")!;
    expect(frame).toHaveAttribute("data-sidebar", "expanded");

    const fold = within(side).getByRole("button", {
      name: "Collapse the sidebar",
    });
    await userEvent.click(fold);

    expect(frame).toHaveAttribute("data-sidebar", "collapsed");
    expect(document.cookie).toContain("balancia_sidebar=collapsed");
    // The same button, still focused, now says what it will do next.
    const unfold = within(side).getByRole("button", {
      name: "Expand the sidebar",
    });
    expect(unfold).toBe(fold);
    expect(unfold).toHaveFocus();

    // Every control keeps its name, though the words are off the screen.
    expect(within(side).getByRole("link", { name: "Home" })).toBeTruthy();
    expect(
      within(side).getByRole("link", {
        // The figure and its currency are held together by a no-break space.
        name: /^Lisbon, March, you are owed €248\.00, you owe CHF\s62\.20$/,
      }),
    ).toBeTruthy();
    expect(within(side).getByText("Home")).toHaveClass("sr-only");

    await userEvent.click(unfold);
    expect(frame).toHaveAttribute("data-sidebar", "expanded");
    expect(document.cookie).not.toContain("balancia_sidebar=collapsed");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("draws folded from the first paint when the device asked for it", () => {
    const side = renderSidebar({ collapsed: true });
    expect(document.querySelector("[data-slot=app-frame]")).toHaveAttribute(
      "data-sidebar",
      "collapsed",
    );
    expect(
      within(side).getByRole("button", { name: "Expand the sidebar" }),
    ).toBeTruthy();
  });

  /**
   * Home and a group are two layouts, so moving between them mounts a new
   * frame, and the router may hand it a render kept from before the toggle
   * was last pressed. The browser's cookie is the newer word.
   */
  it("takes the device's cookie over a render made before it changed", () => {
    cleanup();
    document.cookie = "balancia_sidebar=collapsed; path=/";
    renderWithIntl(
      <SidebarFrame initialCollapsed={false}>
        <p>screen</p>
      </SidebarFrame>,
    );
    expect(document.querySelector("[data-slot=app-frame]")).toHaveAttribute(
      "data-sidebar",
      "collapsed",
    );
  });

  it("shows a folded control's name as a tip on focus", async () => {
    const side = renderSidebar({ collapsed: true });

    await act(async () => {
      within(side).getByRole("link", { name: "Home" }).focus();
    });
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Home");
  });

  it("gives a guest their group, the case for an account and the theme", () => {
    const side = renderSidebar({
      isGuest: true,
      group: { id: "g1", name: "Lisbon, March" },
      pathname: "/groups/g1",
    });

    expect(within(side).getByText("Lisbon, March")).toBeInTheDocument();
    expect(
      within(side).getByRole("button", { name: /Search this group/ }),
    ).toBeDisabled();
    expect(
      within(side).getByRole("link", { name: "Add expense" }),
    ).toHaveAttribute("href", "/groups/g1/expenses/new");
    expect(within(side).getByText("Keep Lisbon, March")).toBeInTheDocument();
    expect(within(side).getByRole("button", { name: "Theme" })).toBeTruthy();
    expect(within(side).getByText("guest")).toBeInTheDocument();

    // One group and no account: nowhere else to go, nothing to be told.
    expect(within(side).queryByRole("link", { name: "Home" })).toBeNull();
    expect(
      within(side).queryByRole("link", { name: "Balancia home" }),
    ).toBeNull();
    expect(within(side).queryByRole("navigation")).toBeNull();
    expect(within(side).queryByRole("link", { name: /Settings/ })).toBeNull();
  });
});
