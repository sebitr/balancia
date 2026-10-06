import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Bell, Shield } from "lucide-react";
import { SettingsPane } from "./hub-link";
import { SettingsLinkRow } from "./settings-row";
import { IdentityCard } from "./identity-card";

/**
 * A hub row, on the phone's hub and in the desk's pane.
 *
 * On a phone the hub is a page and every row pushes its screen over it; none
 * of them is the current page, because the hub is. From `lg` up the same rows
 * stand beside the screen they lead to, so they stop pushing — a peer does not
 * arrive from anywhere — and the one whose screen is showing says so. On
 * `/settings` itself that is the first screen, the account, which the hub page
 * renders beside the pane.
 */

const state = vi.hoisted(() => ({ pathname: "/settings" as string | null }));

vi.mock("next/navigation", () => ({
  usePathname: () => state.pathname,
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

function Rows() {
  return (
    <>
      <IdentityCard name="Ada" email="ada@example.com" photoVersion={null} />
      <SettingsLinkRow
        href="/settings/notifications"
        icon={Bell}
        label="Notifications"
        summary="All on"
      />
      <SettingsLinkRow
        href="/settings/security"
        icon={Shield}
        label="Sign-in & security"
      />
    </>
  );
}

const link = (name: RegExp) => screen.getByRole("link", { name });

beforeEach(() => {
  state.pathname = "/settings";
});

describe("on the phone's hub", () => {
  it("pushes every screen over the hub", () => {
    render(<Rows />);

    expect(link(/Notifications/)).toHaveAttribute("data-transition", "push");
    expect(link(/Ada/)).toHaveAttribute("data-transition", "push");
  });

  it("lights no row, because the hub is the page", () => {
    // Even at an address a row leads to — the hub is not drawn there on a
    // phone, but nothing about the row should depend on that.
    state.pathname = "/settings/notifications";

    render(<Rows />);

    expect(link(/Notifications/)).not.toHaveAttribute("aria-current");
    expect(link(/Ada/)).not.toHaveAttribute("aria-current");
  });
});

describe("in the desk's pane", () => {
  it("lights the row whose screen is beside it, and only that one", () => {
    state.pathname = "/settings/notifications";

    render(
      <SettingsPane>
        <Rows />
      </SettingsPane>,
    );

    expect(link(/Notifications/)).toHaveAttribute("aria-current", "page");
    expect(link(/Notifications/)).toHaveClass("bg-wash-3");
    expect(link(/Sign-in/)).not.toHaveAttribute("aria-current");
    expect(link(/Sign-in/)).not.toHaveClass("bg-wash-3");
    expect(link(/Ada/)).not.toHaveAttribute("aria-current");
  });

  it("lights the account on /settings, the screen the hub page shows there", () => {
    render(
      <SettingsPane>
        <Rows />
      </SettingsPane>,
    );

    expect(link(/Ada/)).toHaveAttribute("aria-current", "page");
    expect(link(/Notifications/)).not.toHaveAttribute("aria-current");
  });

  it("swaps the screen beside it without moving anything", () => {
    render(
      <SettingsPane>
        <Rows />
      </SettingsPane>,
    );

    expect(link(/Notifications/)).not.toHaveAttribute("data-transition");
    expect(link(/Ada/)).not.toHaveAttribute("data-transition");
  });
});
