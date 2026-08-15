import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * What the header offers on a group screen, and to whom.
 *
 * `Link` is swapped for a plain anchor that writes `transitionTypes` to an
 * attribute, as in `group-nav.test.tsx`: which way a tap moves the screen
 * leaves no other trace in the DOM. The group list is a Server Action, so it
 * is stubbed — the subject here is what the panel makes of the positions, not
 * how they are computed.
 */
const nav = vi.hoisted(() => ({ pathname: "/groups/g1/expenses" }));

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

vi.mock("@/modules/balances/actions", () => ({
  loadSwitcherGroups: () =>
    Promise.resolve([
      {
        id: "g1",
        name: "Annecy weekend",
        icon: null,
        iconColor: null,
        direction: "settled",
        amounts: [],
      },
      {
        id: "g2",
        name: "Maison",
        icon: null,
        iconColor: null,
        direction: "owes",
        amounts: [{ minorUnits: "14320", currency: "CHF" }],
      },
      {
        id: "g3",
        name: "Ski Verbier",
        icon: null,
        iconColor: null,
        direction: "settled",
        amounts: [],
      },
    ]),
}));

const { GroupSwitcher, equivalentPath } = await import("./group-switcher");

function renderHeader({ isGuest = false } = {}) {
  return renderWithIntl(
    <GroupSwitcher groupId="g1" groupName="Annecy weekend" isGuest={isGuest} />,
  );
}

/** Opens the panel and hands back the row for the named group. */
async function openPanel() {
  await userEvent.click(screen.getByRole("button", { name: "Annecy weekend" }));
  // The list arrives after the panel does; the first row proves it landed.
  await screen.findByRole("link", { name: /Maison/ });
}

describe("GroupSwitcher", () => {
  it("gives a member the way out and the way sideways", () => {
    renderHeader();

    const back = screen.getByRole("link", { name: "Back to dashboard" });
    expect(back).toHaveAttribute("href", "/dashboard");
    // Leaving a group is a move back up, not a move deeper.
    expect(back).toHaveAttribute("data-transition", "pop");
    expect(
      screen.getByRole("button", { name: "Annecy weekend" }),
    ).toBeInTheDocument();
  });

  it("leaves a guest the name alone, with nothing to reach", () => {
    renderHeader({ isGuest: true });

    expect(screen.getByText("Annecy weekend")).toBeInTheDocument();
    // A guest has no dashboard behind the group, so neither control is here —
    // and nothing is left for the keyboard to land on.
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("marks the group being viewed rather than pricing it", async () => {
    renderHeader();
    await openPanel();

    const current = screen.getByRole("link", { name: /Annecy weekend/ });
    expect(current).toHaveAttribute("aria-current", "true");
    expect(within(current).getByText("you are here")).toBeInTheDocument();
  });

  it("shows each group's own position, in its own currency", async () => {
    renderHeader();
    await openPanel();

    const owing = screen.getByRole("link", { name: /Maison/ });
    // The word carries the sign; the figure is never negative and never
    // converted into anyone else's currency.
    expect(within(owing).getByText(/you owe/)).toHaveTextContent("143.20");
    expect(within(owing).queryByText(/-/)).not.toBeInTheDocument();

    const square = screen.getByRole("link", { name: /Ski Verbier/ });
    expect(within(square).getByText("settled")).toBeInTheDocument();
  });

  it("keeps the way to the dashboard at the end of the list", async () => {
    renderHeader();
    await openPanel();

    const home = screen.getByRole("link", { name: /all groups/ });
    expect(home).toHaveAttribute("href", "/dashboard");
    expect(home).toHaveAttribute("data-transition", "pop");
  });

  it("lands on the same section of the group it switches to", async () => {
    renderHeader();
    await openPanel();

    const other = screen.getByRole("link", { name: /Maison/ });
    expect(other).toHaveAttribute("href", "/groups/g2/expenses");
    // Another group is a peer of this one, not somewhere inside it.
    expect(other).toHaveAttribute("data-transition", "switch-forward");
  });
});

describe("equivalentPath", () => {
  it("carries the section across", () => {
    expect(equivalentPath("/groups/g1/members", "g1", "g2")).toBe(
      "/groups/g2/members",
    );
  });

  it("stops at the section, because anything deeper names a row", () => {
    // g2 has no expense e9 — the section is the deepest thing both groups have.
    expect(equivalentPath("/groups/g1/expenses/e9", "g1", "g2")).toBe(
      "/groups/g2/expenses",
    );
  });

  it("falls back to the overview, which every group has", () => {
    expect(equivalentPath("/groups/g1", "g1", "g2")).toBe("/groups/g2");
    expect(equivalentPath("/groups/g1/nowhere", "g1", "g2")).toBe("/groups/g2");
    expect(equivalentPath("/dashboard", "g1", "g2")).toBe("/groups/g2");
  });

  it("does not carry across the one section that 404s without permission", () => {
    // Importing is owner-only and answers `notFound` to everyone else, so an
    // owner switching out of it would land in a dead end rather than a group.
    expect(equivalentPath("/groups/g1/import", "g1", "g2")).toBe("/groups/g2");
  });
});
