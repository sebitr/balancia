import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { SplitSummaryRow } from "./split-summary-row";

const GROUP = [
  { id: "robin", displayName: "Robin Audit" },
  { id: "anna", displayName: "Anna" },
  { id: "jonas", displayName: "Jonas" },
  { id: "marta", displayName: "Marta" },
  { id: "sam", displayName: "Sam" },
  { id: "lea", displayName: "Léa" },
];

function renderRow(
  overrides: Partial<Parameters<typeof SplitSummaryRow>[0]> = {},
) {
  return renderWithIntl(
    <SplitSummaryRow
      payerName="Anna"
      included={GROUP}
      memberCount={GROUP.length}
      summary={{
        key: "equalEach",
        params: { count: GROUP.length, amount: "CHF 10.00" },
      }}
      onOpen={vi.fn()}
      {...overrides}
    />,
  );
}

/** The faces drawn on the "split between" half of the row. */
function splitFaces(): Element[] {
  const half = screen.getByText("Split between").parentElement;
  return [...(half?.querySelectorAll('[data-slot="avatar"]') ?? [])];
}

describe("the split summary row", () => {
  /**
   * The audit's case: three faces beside the word left "Ever…" on a 375px
   * phone. All of them is said in the word alone.
   */
  it("says Everyone without drawing anybody's face", () => {
    renderRow();

    expect(screen.getByText("Everyone")).toBeInTheDocument();
    expect(splitFaces()).toHaveLength(0);
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
  });

  it("draws three faces for part of the group and counts the rest", () => {
    renderRow({
      included: GROUP.slice(0, 5),
      summary: {
        key: "equalEach",
        params: { count: 5, amount: "CHF 12.00" },
      },
    });

    expect(splitFaces()).toHaveLength(3);
    expect(screen.getByText("+2")).toBeInTheDocument();
    expect(screen.getByText("5 of 6")).toBeInTheDocument();
  });

  it("draws every face when there are three or fewer", () => {
    renderRow({
      included: GROUP.slice(1, 3),
      summary: {
        key: "equalEach",
        params: { count: 2, amount: "CHF 30.00" },
      },
    });

    expect(splitFaces()).toHaveLength(2);
    expect(screen.queryByText(/^\+\d/)).not.toBeInTheDocument();
    expect(screen.getByText("2 of 6")).toBeInTheDocument();
  });

  /** The reader is "You" here, as on the sheet the row opens. */
  it("says You when the reader paid", () => {
    renderRow({ payerName: "Robin Audit", payerIsYou: true });

    expect(screen.getByRole("button")).toHaveTextContent(/Paid byR?You/);
    expect(screen.queryByText("Robin Audit")).not.toBeInTheDocument();
  });

  it("says Toi in French", () => {
    renderWithIntl(
      <SplitSummaryRow
        payerName="Robin Audit"
        payerIsYou
        included={GROUP}
        memberCount={GROUP.length}
        summary={{
          key: "equalEach",
          params: { count: GROUP.length, amount: "CHF 10.00" },
        }}
        onOpen={vi.fn()}
      />,
      { locale: "fr" },
    );

    expect(screen.getByText("Toi")).toBeInTheDocument();
    expect(screen.getByText("Tout le monde")).toBeInTheDocument();
  });
});
