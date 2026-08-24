import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { BalanceList, type BalanceRowView } from "./balance-list";

/**
 * The bars are a comparison, and one only reads as such while every bar hangs
 * on the same two lines with its centre in the same place. That is a layout
 * property, not a rendering one, so what these tests hold is the structure it
 * comes from: three columns declared once on the list, every row subgridded
 * onto them, and the gap stated in one place.
 *
 * Rows carrying their own copy of the track list is how this breaks. Each one
 * then fits the amount column to its own amount, and since the amounts differ
 * in length — "−21 661,90 CHF" against "+8 556,57 CHF" — the bars step in and
 * out by a few pixels down the card, which is exactly what a reader compares
 * them by.
 */

function row(overrides: Partial<BalanceRowView> = {}): BalanceRowView {
  return {
    participantId: "p1",
    name: "Cyril",
    currency: "CHF",
    minorUnits: "-2166190",
    isSelf: false,
    remindedAt: null,
    ...overrides,
  };
}

const ROWS: readonly BalanceRowView[] = [
  row(),
  row({ participantId: "p2", name: "Hervé", minorUnits: "855657" }),
  row({
    participantId: "p3",
    name: "Seb",
    minorUnits: "1310533",
    isSelf: true,
  }),
];

function render(props: Partial<Parameters<typeof BalanceList>[0]> = {}) {
  return renderWithIntl(
    <BalanceList rows={ROWS} groupId="g1" limit={5} {...props} />,
  );
}

/** Classes as authored, safe for elements whose `className` is not a string. */
function classesOf(element: Element): string {
  return element.getAttribute("class") ?? "";
}

function personRows(): HTMLElement[] {
  return screen
    .getAllByRole("listitem")
    .filter((item) =>
      within(item)
        .getByRole("link")
        .getAttribute("href")
        ?.includes("/members/"),
    );
}

describe("the comparison bars' alignment", () => {
  it("declares the columns once, on the list itself", () => {
    render();
    const list = screen.getByRole("list");

    expect(classesOf(list)).toMatch(/(^|\s)grid(\s|$)/);
    expect(classesOf(list)).toMatch(/grid-cols-\[/);
    // A column gap of the list's own: a subgrid inherits it.
    expect(classesOf(list)).toMatch(/gap-x-/);
  });

  it("gives no row a track list of its own", () => {
    render();
    const list = screen.getByRole("list");

    const withOwnColumns = [...list.querySelectorAll("*")].filter((element) =>
      /grid-cols-\[/.test(classesOf(element)),
    );

    expect(withOwnColumns).toEqual([]);
  });

  it("subgrids each row, and its link, onto the list's columns", () => {
    render();

    for (const item of personRows()) {
      expect(classesOf(item)).toContain("grid-cols-subgrid");
      expect(classesOf(item)).toContain("col-span-3");

      const link = within(item).getByRole("link");
      expect(classesOf(link)).toContain("grid-cols-subgrid");
      expect(classesOf(link)).toContain("col-span-3");
    }
  });

  it("leaves the inherited gap alone in every subgrid", () => {
    render();
    const list = screen.getByRole("list");

    const restated = [...list.querySelectorAll("*")].filter(
      (element) =>
        classesOf(element).includes("grid-cols-subgrid") &&
        /(^|\s)gap(-x)?-/.test(classesOf(element)),
    );

    expect(restated).toEqual([]);
  });

  it("runs the row of last resort across all three columns", () => {
    render({ limit: 2, participantCount: 3 });

    const item = screen
      .getAllByRole("listitem")
      .find((candidate) =>
        within(candidate)
          .getByRole("link")
          .getAttribute("href")
          ?.endsWith("/members"),
      );

    expect(item).toBeDefined();
    expect(classesOf(item!)).toContain("col-span-3");
  });
});

describe("the comparison bars themselves", () => {
  /** The filled part of each bar, in source order. */
  function fills(container: HTMLElement): string[] {
    return [...container.querySelectorAll<HTMLElement>("[style*='width']")].map(
      (fill) => fill.style.width,
    );
  }

  it("measures everyone against the largest balance in their currency", () => {
    const { container } = render();

    // Half the track is the most a bar can take, so the largest fills it and
    // the rest are read off against that.
    expect(fills(container)).toEqual(["50%", "19%", "30%"]);
  });

  it("scales each currency against its own largest", () => {
    const { container } = render({
      rows: [
        row({ minorUnits: "-2000000" }),
        row({ participantId: "p2", name: "Hervé", minorUnits: "1000000" }),
        row({
          participantId: "p3",
          name: "Seb",
          currency: "EUR",
          minorUnits: "1000",
        }),
      ],
    });

    // The lone euro balance is its currency's largest, however small it is
    // beside the francs.
    expect(fills(container)).toEqual(["50%", "25%", "50%"]);
  });

  it("draws nothing for a settled balance", () => {
    const { container } = render({
      rows: [
        row({ minorUnits: "0" }),
        row({ participantId: "p2", name: "Hervé" }),
      ],
    });

    expect(fills(container)).toEqual(["50%"]);
  });
});
