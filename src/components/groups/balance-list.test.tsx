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

/**
 * The direction is said in words a sighted reader can see. It used to be a
 * sign and a colour, with "owes money" read out to a screen reader and kept
 * from everyone else — and the reader's own row printed their own name, cut
 * short, where every other screen says "You".
 */
describe("the words beside each balance", () => {
  /** A person's row, found the way a reader reaches it: by its link. */
  function rowOf(participantId: string): HTMLElement {
    return screen
      .getAllByRole("link")
      .find((link) =>
        link.getAttribute("href")?.endsWith(`/members/${participantId}`),
      )!;
  }

  it("says who owes and who gets back, under their names", () => {
    render();

    const cyril = within(rowOf("p1"));
    expect(cyril.getByText("Cyril")).toBeVisible();
    expect(cyril.getByText("owes")).toBeVisible();
    expect(cyril.getByText("owes")).not.toHaveClass("sr-only");

    const herve = within(rowOf("p2"));
    expect(herve.getByText("gets back")).toBeVisible();
  });

  it("calls the reader You, whatever their name is", () => {
    render();

    const self = within(rowOf("p3"));
    expect(self.getByText("You")).toBeVisible();
    expect(self.getByText("get back")).toBeVisible();
    expect(self.queryByText("Seb")).toBeNull();
  });

  it("drops the sign once the word has said which way it goes", () => {
    render();

    for (const id of ["p1", "p2", "p3"]) {
      expect(rowOf(id)).not.toHaveTextContent("+");
      expect(rowOf(id)).not.toHaveTextContent("−");
    }
    expect(rowOf("p1")).toHaveTextContent("CHF 21,661.90");
  });

  it("keeps the tone on the figure, from TONE", () => {
    render();

    expect(within(rowOf("p1")).getByText("CHF 21,661.90")).toHaveClass(
      "tabular-nums",
    );
    expect(
      within(rowOf("p1")).getByText("CHF 21,661.90").parentElement,
    ).toHaveClass("text-negative-ink");
    expect(
      within(rowOf("p2")).getByText("CHF 8,556.57").parentElement,
    ).toHaveClass("text-positive-ink");
  });

  it("phrases a settled balance instead of printing a zero", () => {
    render({
      rows: [
        row({ minorUnits: "0" }),
        row({ participantId: "p2", name: "Hervé" }),
      ],
    });

    const settled = rowOf("p1");
    expect(within(settled).getByText("Settled up")).toBeVisible();
    expect(settled).not.toHaveTextContent("0.00");
  });

  it("says it in French as whole sentences, never Toi with a verb", () => {
    renderWithIntl(<BalanceList rows={ROWS} groupId="g1" limit={5} />, {
      locale: "fr",
    });

    const self = within(rowOf("p3"));
    expect(self.getByText("Tu")).toBeVisible();
    expect(self.getByText("récupères")).toBeVisible();
    expect(rowOf("p3")).not.toHaveTextContent("Toi");
    expect(within(rowOf("p1")).getByText("doit")).toBeVisible();
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
