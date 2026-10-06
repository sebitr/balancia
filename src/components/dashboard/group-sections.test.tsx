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

    // Whole units: the list is scanned, and the centimes are inside the group.
    // This one is whole already, so it carries no "≈".
    expect(screen.getByText("€100")).toBeVisible();
    // The section label carries the direction visually, so the row's own word
    // is present but not shown — colour is never the only signal.
    const word = screen.getByText("owes");
    expect(word).toBeInTheDocument();
    expect(word).toHaveClass("sr-only");
  });

  it("uses minus and plus signs for owing and owed amounts", () => {
    renderWithIntl(
      <GroupList
        groups={[
          row(),
          row({
            id: "g2",
            name: "Lisbon, March",
            amounts: [{ minorUnits: "24800", currency: "EUR" }],
          }),
        ]}
        now={NOW}
      />,
    );

    expect(
      within(screen.getByText("Flatshare").closest("li")!).getByText("−"),
    ).toBeVisible();
    expect(
      within(screen.getByText("Lisbon, March").closest("li")!).getByText("+"),
    ).toBeVisible();
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

    expect(screen.getByText("CHF 210")).toBeVisible();
  });

  /**
   * Whole units are a choice (#100), and the widget above keeps the centimes
   * whenever it shows a group's own currency. "− CHF 961" under "CHF 960.84"
   * read as a second, different debt, so a rounded figure says it is one.
   */
  it("marks a figure the rounding has moved, and only that one", () => {
    renderWithIntl(
      <GroupList
        groups={[
          row({ amounts: [{ minorUnits: "-96084", currency: "CHF" }] }),
          row({
            id: "g2",
            name: "Lisbon, March",
            amounts: [{ minorUnits: "888", currency: "USD" }],
          }),
          row({
            id: "g3",
            name: "Tokyo",
            amounts: [{ minorUnits: "4500", currency: "JPY" }],
          }),
        ]}
        now={NOW}
      />,
    );

    expect(screen.getByText("≈ CHF 961")).toBeVisible();
    expect(screen.getByText("≈ $9")).toBeVisible();
    // Nothing to round in a currency with no minor unit.
    expect(screen.getByText("¥4,500")).toBeVisible();
    // And a whole figure is not cast into doubt.
    expect(screen.queryByText(/≈ €/)).not.toBeInTheDocument();
  });

  it("shows a debt smaller than one unit exactly, rather than as nothing", () => {
    renderWithIntl(
      <GroupList
        groups={[row({ amounts: [{ minorUnits: "-40", currency: "CHF" }] })]}
        now={NOW}
      />,
    );

    expect(screen.getByText("CHF 0.40")).toBeVisible();
    expect(screen.queryByText(/CHF 0$/)).not.toBeInTheDocument();
  });

  it("keeps a five-figure amount whole beside a long name", () => {
    renderWithIntl(
      <GroupList
        groups={[
          row({
            name: "Summer house in the Engadine, shared by both families",
            amounts: [{ minorUnits: "-1234567", currency: "CHF" }],
          }),
        ]}
        now={NOW}
      />,
    );

    // The name is the one that gives way; the figure never shrinks.
    const figure = screen.getByText("≈ CHF 12,346");
    expect(figure.closest(".shrink-0")).not.toBeNull();
    expect(figure.closest(".truncate")).toBeNull();
  });
});

/*
 * The same rows from `lg`, as the desktop board "01 · Home" draws them. jsdom
 * runs no media queries, so both drawings are in the document here; what is
 * held is what each width is given, by the classes that give it.
 */
describe("GroupList from lg", () => {
  const mixed = row({
    name: "Lisbon, March",
    memberNames: ["Amélie", "Ravi", "Jonas"],
    participantCount: 6,
    amounts: [
      { minorUnits: "24800", currency: "EUR" },
      { minorUnits: "-6220", currency: "CHF" },
    ],
  });

  it("says each figure's direction in words beside it, one line per currency", () => {
    renderWithIntl(<GroupList groups={[mixed]} now={NOW} />);

    const owed = screen.getByText("you are owed");
    const owe = screen.getByText("you owe");
    // In the tone's own ink, never the accent's.
    expect(owed).toHaveClass("text-positive-ink");
    expect(owe).toHaveClass("text-negative-ink");
    expect(owed.className).not.toMatch(/primary/);
    // Only where there is room to draw it; the figure's own word still says
    // it to a screen reader at every width.
    expect(owed).toHaveClass("hidden", "lg:inline");
    expect(owed).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByText("gets back")).toHaveClass("sr-only");
    // Each beside its own figure.
    expect(owed.parentElement).toHaveTextContent("€248");
    expect(owe.parentElement).toHaveTextContent("CHF 62");
  });

  it("drops the sign where the word stands beside the figure", () => {
    renderWithIntl(<GroupList groups={[mixed]} now={NOW} />);

    const sign = screen.getByText("+");
    expect(sign).toHaveAttribute("aria-hidden", "true");
    // The figure's box hides its one decorative child from `lg`: the sign.
    expect(sign.parentElement?.className).toContain(
      "lg:[&>[aria-hidden=true]]:hidden",
    );
  });

  it("counts the people beside the faces", () => {
    renderWithIntl(<GroupList groups={[mixed]} now={NOW} />);

    const count = screen.getByText(/^6 people ·/);
    expect(count).toHaveClass("hidden", "lg:inline");
    expect(count.parentElement).toHaveTextContent("6 people · 2 days ago");
  });
});
