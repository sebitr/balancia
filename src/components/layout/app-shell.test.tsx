import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
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
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard" }));

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
