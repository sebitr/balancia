import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * Who gets the theme picker in the header.
 *
 * A signed-in reader has Settings › Appearance one tap behind the avatar, so
 * the header carries no second copy of it. A guest has no settings hub, and
 * the header is the only place they can change the theme — so for them it
 * stays. The shell's other children reach for the request, the router or the
 * theme provider, none of which exist in jsdom; each is swapped for a stub
 * that leaves a trace, since the subject here is only what the header holds.
 */
// `useRouter` is for `RefreshOnReturn`, which the shell mounts on every
// screen. It refreshes on a `visibilitychange` and nothing here fires one, so
// there is nothing for the stub to record.
vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
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
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => <a href="/notifications">Notifications</a>,
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

function renderHeaderFor(actor: { label: string; isGuest: boolean }) {
  cleanup();
  renderWithIntl(
    <AppShell actor={actor}>
      <p>screen</p>
    </AppShell>,
  );
}

describe("AppShell header", () => {
  it("leaves the theme to the settings hub for a signed-in reader", () => {
    renderHeaderFor({ label: "Ada", isGuest: false });
    expect(screen.queryByRole("button", { name: "Theme" })).toBeNull();
    expect(screen.getByRole("link", { name: "Notifications" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
  });

  it("keeps the theme picker for a guest, who has no settings hub", () => {
    renderHeaderFor({ label: "Marta", isGuest: true });
    expect(screen.getByRole("button", { name: "Theme" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Notifications" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });
});

/**
 * A group's shell, whose header stands up as a rail from `lg` up.
 *
 * The rail is the header's own controls with the group's navigation between
 * them, so the order they are written in is the order a keyboard meets them:
 * the switcher, the places, then the bell and the account, then the screen —
 * with a way past all of it first.
 */
describe("AppShell with a rail", () => {
  function renderGroupShell() {
    cleanup();
    renderWithIntl(
      <AppShell
        actor={{ label: "Ada", isGuest: false }}
        leading={<Link href="/groups/g1">Lisbon, March</Link>}
        rail={
          <nav aria-label="Group sections">
            <Link href="/groups/g1/expenses/new">Add</Link>
            <Link href="/groups/g1">Overview</Link>
          </nav>
        }
        bottomNav={<nav aria-label="Group sections (bar)" />}
      >
        <Link href="/groups/g1/expenses/e1">An expense on the screen</Link>
      </AppShell>,
    );
  }

  it("carries the navigation between the switcher and the account", () => {
    renderGroupShell();

    const header = screen.getByRole("banner");
    const order = within(header)
      .getAllByRole("link")
      .map((link) => link.textContent);
    expect(order).toEqual([
      "Lisbon, March",
      "Add",
      "Overview",
      "Notifications",
      expect.stringContaining("Ada"),
    ]);
  });

  it("opens with a way past the rail to the screen", () => {
    renderGroupShell();

    const links = screen.getAllByRole("link");
    expect(links[0]).toHaveTextContent("Skip to content");
    expect(links[0]).toHaveAttribute("href", "#app-content");
    expect(screen.getByRole("main")).toHaveAttribute("id", "app-content");
    // Everything in the rail comes between the way past it and the screen.
    expect(links.at(-1)).toHaveTextContent("An expense on the screen");
  });

  it("offers no way past a header that is only a top bar", () => {
    renderHeaderFor({ label: "Ada", isGuest: false });
    expect(screen.queryByRole("link", { name: "Skip to content" })).toBeNull();
  });
});
