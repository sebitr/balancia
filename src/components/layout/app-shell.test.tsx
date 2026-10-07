import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * What the shell puts around a screen, and at which width.
 *
 * Below `lg` a header along the top; from `lg` up the sidebar, on every
 * signed-in screen — Home and Notifications as well as a group's. Both are in
 * the document at every width and CSS shows one, so each test scopes itself
 * to the one it is about, and the last block stands the two widths up with
 * the rules Tailwind emits there.
 *
 * The shell's other children reach for the request, the router or the theme
 * provider, none of which exist in jsdom; each is swapped for a stub that
 * leaves a trace, since the subject here is only what the chrome holds.
 */
// `useRouter` is for `RefreshOnReturn`, which the shell mounts on every
// screen. It refreshes on a `visibilitychange` and nothing here fires one, so
// there is nothing for the stub to record.
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

vi.mock("@/components/demo/demo-banner", () => ({ DemoBanner: () => null }));
// Server Components, which jsdom cannot render: each stands in with the shape
// it draws, so the order and the scoping can be read.
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: ({ variant }: { variant?: string }) => (
    <a href="/notifications" data-variant={variant ?? "header"}>
      Notifications
    </a>
  ),
}));
vi.mock("./sidebar-groups-loader", () => ({
  SidebarGroupsLoader: ({ groupId }: { groupId: string | null }) => (
    <ul>
      <li>
        <a href="#g1" aria-current={groupId === "g1" ? "true" : undefined}>
          Lisbon, March
        </a>
      </li>
    </ul>
  ),
}));
vi.mock("@/components/notifications/notification-refresh", () => ({
  NotificationRefresh: () => null,
}));
vi.mock("@/components/pwa/install-instructions", () => ({
  InstallInstructions: () => null,
}));
vi.mock("@/components/theme/theme-toggle", () => ({
  ThemeToggle: () => (
    <button type="button" aria-label="Theme">
      Theme
    </button>
  ),
}));
vi.mock("@/components/motion/screen", () => ({
  Screen: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

const { AppShell } = await import("./app-shell");
const { default: Link } = await import("next/link");

function renderShell(
  actor: { label: string; isGuest: boolean },
  options: { group?: { id: string; name: string }; pathname?: string } = {},
) {
  cleanup();
  nav.pathname = options.pathname ?? "/dashboard";
  renderWithIntl(
    <AppShell
      actor={actor}
      group={options.group ?? null}
      leading={
        options.group ? (
          <Link href={`/groups/${options.group.id}`}>{options.group.name}</Link>
        ) : undefined
      }
      sidebarAdd={
        options.group ? (
          <Link href={`/groups/${options.group.id}/expenses/new`}>
            Add expense
          </Link>
        ) : undefined
      }
      groupHeader={
        options.group ? (
          <nav aria-label="Group sections">
            <Link href={`/groups/${options.group.id}`}>Overview</Link>
          </nav>
        ) : undefined
      }
      bottomNav={
        options.group ? <nav aria-label="Group sections (bar)" /> : undefined
      }
    >
      <Link href="/groups/g1/expenses/e1">An expense on the screen</Link>
    </AppShell>,
  );
}

const header = () =>
  document.querySelector<HTMLElement>("[data-slot=app-header]")!;
const sidebar = () =>
  document.querySelector<HTMLElement>("[data-slot=app-sidebar]")!;

describe("AppShell header, below lg", () => {
  it("leaves the theme to the settings hub for a signed-in reader", () => {
    renderShell({ label: "Ada", isGuest: false });
    expect(
      within(header()).queryByRole("button", { name: "Theme" }),
    ).toBeNull();
    expect(
      within(header()).getByRole("link", { name: "Notifications" }),
    ).toHaveAttribute("data-variant", "header");
    // The avatar, which leads to the hub: named for whose it is, since a
    // group's tab bar has a "Settings" of its own.
    expect(
      within(header()).getByRole("link", { name: "Your account" }),
    ).toBeTruthy();
  });

  it("keeps the theme picker for a guest, who has no settings hub", () => {
    renderShell(
      { label: "Marta", isGuest: true },
      { group: { id: "g1", name: "Lisbon, March" }, pathname: "/groups/g1" },
    );
    expect(
      within(header()).getByRole("button", { name: "Theme" }),
    ).toBeTruthy();
    expect(
      within(header()).queryByRole("link", { name: "Notifications" }),
    ).toBeNull();
    expect(
      within(header()).queryByRole("link", { name: "Your account" }),
    ).toBeNull();
  });
});

/**
 * From `lg` up, every signed-in screen gets the sidebar — the dashboard as
 * well as a group. What a keyboard meets first is a way past it, then the
 * sidebar top to bottom, then the screen.
 */
describe("AppShell sidebar, from lg", () => {
  it("is drawn on Home, with no group lit and nothing of a group's", () => {
    renderShell({ label: "Ada", isGuest: false });

    const side = sidebar();
    expect(side.tagName).toBe("HEADER");
    expect(within(side).getByRole("link", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      within(side).getByRole("link", { name: "Notifications" }),
    ).toHaveAttribute("data-variant", "sidebar");
    expect(
      within(side).getByRole("navigation", { name: "Your groups" }),
    ).toHaveTextContent("Lisbon, March");
    expect(
      within(side).getByRole("link", { name: "Lisbon, March" }),
    ).not.toHaveAttribute("aria-current");
    // Outside a group, Add asks which group first.
    expect(
      within(side).getByRole("button", { name: "Add expense" }),
    ).toHaveAttribute("aria-haspopup", "dialog");
  });

  it("lights the group and adds to it, inside a group", () => {
    renderShell(
      { label: "Ada", isGuest: false },
      { group: { id: "g1", name: "Lisbon, March" }, pathname: "/groups/g1" },
    );

    const side = sidebar();
    expect(
      within(side).getByRole("link", { name: "Lisbon, March" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      within(side).getByRole("link", { name: "Add expense" }),
    ).toHaveAttribute("href", "/groups/g1/expenses/new");
    // The group's own places are not in the sidebar: they are the header's
    // tabs above the screen.
    expect(
      within(side).queryByRole("navigation", { name: "Group sections" }),
    ).toBeNull();
  });

  it("opens with a way past the sidebar to the screen, on every screen", () => {
    for (const options of [
      {},
      { group: { id: "g1", name: "Lisbon, March" }, pathname: "/groups/g1" },
    ]) {
      renderShell({ label: "Ada", isGuest: false }, options);

      const links = screen.getAllByRole("link");
      expect(links[0]).toHaveTextContent("Skip to content");
      expect(links[0]).toHaveAttribute("href", "#app-content");
      expect(screen.getByRole("main")).toHaveAttribute("id", "app-content");
      expect(links.at(-1)).toHaveTextContent("An expense on the screen");
    }
  });

  it("walks the sidebar top to bottom before the group's tabs and the screen", () => {
    renderShell(
      { label: "Ada", isGuest: false },
      { group: { id: "g1", name: "Lisbon, March" }, pathname: "/groups/g1" },
    );

    // The tab order, with the header along the top taken out the way CSS
    // takes it out from `lg` up.
    const order = [
      ...document.querySelectorAll<HTMLElement>(
        "a[href], button:not([disabled])",
      ),
    ]
      .filter((element) => !header().contains(element))
      .map(
        (element) =>
          element.getAttribute("aria-label") ?? element.textContent?.trim(),
      );

    expect(order).toEqual([
      "Skip to content",
      "Balancia home",
      "Collapse the sidebar",
      // Pressable now the shell mounts the palette it opens; its key hint
      // is part of its text and hidden from a screen reader.
      expect.stringContaining("Search or jump to"),
      "Add expense",
      "Home",
      "Notifications",
      "New group",
      "Lisbon, March",
      expect.stringContaining("Ada"),
      "Overview",
      "An expense on the screen",
    ]);
  });
});

/**
 * Both chromes are in the document at every width, and CSS shows one: the
 * header is `lg:hidden`, the sidebar `hidden lg:flex`. jsdom applies no
 * Tailwind and no media queries, so each width is stood in for by the rules
 * Tailwind emits there.
 */
describe("the header and the sidebar together", () => {
  const WIDTHS = [
    ["a phone", ".hidden { display: none; }", "app-header"],
    [
      "a desktop",
      ".hidden { display: none; } .lg\\:flex { display: flex; } .lg\\:hidden { display: none; }",
      "app-sidebar",
    ],
  ] as const;

  it.each(WIDTHS)("expose exactly one banner on %s", (_width, css, shown) => {
    for (const isGuest of [false, true]) {
      const sheet = document.createElement("style");
      sheet.textContent = css;
      document.head.append(sheet);
      try {
        renderShell(
          { label: "Ada", isGuest },
          {
            group: { id: "g1", name: "Lisbon, March" },
            pathname: "/groups/g1",
          },
        );
        const banners = screen.getAllByRole("banner");
        expect(banners).toHaveLength(1);
        expect(banners[0]).toHaveAttribute("data-slot", shown);
      } finally {
        sheet.remove();
      }
    }
  });
});
