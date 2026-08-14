import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { GroupList, type GroupRowView } from "./group-sections";

/**
 * One row anatomy for both directional sections. Urgency comes from the order
 * and the section label above, never from the row — so a row carries no
 * actions, and an amount is the same size whichever way it points.
 */

const NOW = "2026-08-13T12:00:00.000Z";

function row(overrides: Partial<GroupRowView> = {}): GroupRowView {
  return {
    id: "g1",
    name: "Flatshare",
    icon: null,
    iconColor: null,
    memberNames: ["Sofia", "Mika"],
    participantCount: 2,
    lastActivityAt: "2026-08-11T12:00:00.000Z",
    amounts: [{ minorUnits: "-10000", currency: "EUR" }],
    ...overrides,
  };
}

describe("GroupList", () => {
  it("makes the whole row one link to the group, and offers nothing else", () => {
    renderWithIntl(<GroupList groups={[row()]} now={NOW} />);

    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", "/groups/g1");
    expect(within(link).getByText("Flatshare")).toBeVisible();

    // Every action lives inside the group; the row's only job is to open it.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("keeps the amount's direction as a word for a screen reader", () => {
    renderWithIntl(<GroupList groups={[row()]} now={NOW} />);

    expect(screen.getByText("€100.00")).toBeVisible();
    // The section label carries the direction visually, so the row's own word
    // is present but not shown — colour is never the only signal.
    const word = screen.getByText("owes");
    expect(word).toBeInTheDocument();
    expect(word).toHaveClass("sr-only");
  });

  it("draws an amount the same size whichever way it points", () => {
    const { container } = renderWithIntl(
      <GroupList
        groups={[
          row({ amounts: [{ minorUnits: "-10000", currency: "EUR" }] }),
          row({
            id: "g2",
            name: "Lisbon, March",
            amounts: [{ minorUnits: "24800", currency: "EUR" }],
          }),
        ]}
        now={NOW}
      />,
    );

    const [owing, owed] = [...container.querySelectorAll("li")].map(
      (item) => item.querySelector(".text-base:not(.font-medium)") ?? item,
    );
    expect(owing?.className).toEqual(owed?.className);
  });

  it("names the members of a group once, for the whole stack", () => {
    renderWithIntl(
      <GroupList
        groups={[row({ memberNames: ["Sofia", "Mika"], participantCount: 6 })]}
        now={NOW}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Sofia and 5 others" }),
    ).toBeInTheDocument();
  });

  it("shows every group's own currency, unconverted", () => {
    renderWithIntl(
      <GroupList
        groups={[row({ amounts: [{ minorUnits: "21000", currency: "CHF" }] })]}
        now={NOW}
      />,
    );

    expect(screen.getByText("CHF 210.00")).toBeVisible();
  });
});
