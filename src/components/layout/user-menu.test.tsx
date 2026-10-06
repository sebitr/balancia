import type { MouseEvent, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { readOrigin } from "@/components/settings/settings-origin";
import { UserMenu } from "./user-menu";

/**
 * The avatar in the header: what it is called, and what it remembers.
 *
 * Inside a group the tab bar has a Settings of its own, for the group's, and
 * the avatar used to be announced as "Settings" too — two links of one name to
 * two different places. And pressing it is where settings learns which screen
 * its ✕ should go back to.
 */

// A plain anchor that keeps the press on this page: jsdom cannot navigate,
// and what is under test is what happens before the router takes over.
vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    onClick,
    transitionTypes,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    transitionTypes?: string[];
  }) => (
    <a
      href={href}
      data-transition={transitionTypes?.join(" ")}
      onClick={(event) => {
        onClick?.(event);
        event.preventDefault();
      }}
      {...rest}
    >
      {children}
    </a>
  ),
}));

beforeEach(() => {
  sessionStorage.clear();
});

afterEach(() => {
  window.history.replaceState(null, "", "/");
});

describe("the avatar", () => {
  it("is named for the account it opens, not for settings", () => {
    renderWithIntl(<UserMenu label="Ada Lovelace" isGuest={false} />);

    const link = screen.getByRole("link", { name: "Your account" });
    expect(link).toHaveAttribute("href", "/settings");
    expect(screen.queryByRole("link", { name: "Settings" })).toBeNull();
  });

  it("is named in French in French", () => {
    renderWithIntl(<UserMenu label="Ada Lovelace" isGuest={false} />, {
      locale: "fr",
    });

    expect(
      screen.getByRole("link", { name: "Ton compte" }),
    ).toBeInTheDocument();
  });

  it("remembers the screen it was pressed on, for the ✕ to go back to", async () => {
    window.history.replaceState(null, "", "/groups/g1/expenses?cat=lodging");
    const user = userEvent.setup();
    renderWithIntl(<UserMenu label="Ada Lovelace" isGuest={false} />);

    expect(readOrigin()).toBeNull();
    await user.click(screen.getByRole("link", { name: "Your account" }));

    expect(readOrigin()).toBe("/groups/g1/expenses?cat=lodging");
  });

  it("is no link at all for a guest, who has no account behind it", () => {
    renderWithIntl(<UserMenu label="Ada Lovelace" isGuest />);

    expect(screen.queryByRole("link")).toBeNull();
  });
});
