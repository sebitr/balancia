import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { SplitSheet } from "./split-sheet";

/**
 * The reader on the split sheet: "You", and first.
 *
 * The roster arrives in the group's own order, which put the reader last
 * under their full name — "Robin Audit" at the end of every list on a screen
 * about their own entry.
 */

const MEMBERS = [
  { id: "anna", displayName: "Anna" },
  { id: "jonas", displayName: "Jonas" },
  { id: "robin", displayName: "Robin Audit" },
];

function allocation(participantId: string) {
  return { participantId, amount: 1000n, formatted: "CHF 10.00" };
}

function renderSheet(
  props: Partial<Parameters<typeof SplitSheet>[0]> = {},
  options: { locale?: "en" | "fr" } = {},
) {
  const includedIds = props.includedIds ?? MEMBERS.map((member) => member.id);
  return renderWithIntl(
    <Sheet open>
      <SheetContent side="bottom">
        <SplitSheet
          members={MEMBERS}
          selfId="robin"
          title="Payment and split"
          totalFormatted="CHF 30.00"
          currency="CHF"
          payerId="robin"
          onPayerChange={vi.fn()}
          includedIds={includedIds}
          onIncludedChange={vi.fn()}
          method="equal"
          onMethodChange={vi.fn()}
          values={{}}
          onValueChange={vi.fn()}
          preview={{ ok: true, allocations: includedIds.map(allocation) }}
          note={null}
          alwaysSplit={null}
          onAlwaysSplitChange={vi.fn()}
          onSeveralChange={vi.fn()}
          payerAmounts={{}}
          onPayerAmountChange={vi.fn()}
          onDone={vi.fn()}
          {...props}
        />
      </SheetContent>
    </Sheet>,
    options,
  );
}

describe("the reader on the split sheet", () => {
  it("is You, first among who paid", () => {
    renderSheet();

    const payers = within(
      screen.getByRole("radiogroup", { name: "Paid by" }),
    ).getAllByRole("radio");
    expect(payers.map((pill) => pill.getAttribute("aria-label"))).toEqual([
      "Paid by you",
      "Paid by Anna",
      "Paid by Jonas",
    ]);
    expect(payers[0]).toHaveTextContent("You");
    expect(screen.queryByText("Robin Audit")).not.toBeInTheDocument();
  });

  it("is You, first among who it is split between", () => {
    renderSheet();

    const included = screen.getAllByRole("button", { name: /^Include/ });
    expect(included[0]).toHaveAccessibleName("Include yourself in the split");
    expect(included[0]).toHaveTextContent("You");
    expect(included[1]).toHaveAccessibleName("Include Anna in the split");
  });

  it("is You, first in the per-person list, with the fields said to you", () => {
    renderSheet({ method: "exact" });

    const rows = screen.getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("You");
    expect(screen.getByLabelText("Your exact amount")).toBe(
      within(rows[0]).getByRole("textbox"),
    );
    expect(rows[1]).toHaveTextContent("Anna");
  });

  /**
   * Drawn first, counted where they always were. The remainder of an equal
   * split is handed out in member order, so the reader moving to the top of
   * the list must not move them to the front of the queue for the extra cent.
   */
  it("keeps the split itself in the group's order", async () => {
    const user = userEvent.setup();
    const onIncludedChange = vi.fn();
    renderSheet({ includedIds: ["anna", "robin"], onIncludedChange });

    await user.click(
      screen.getByRole("button", { name: "Include Jonas in the split" }),
    );

    expect(onIncludedChange).toHaveBeenCalledWith(["anna", "jonas", "robin"]);
  });

  it("is You on the several-payers panel too", () => {
    renderSheet({ several: true });

    expect(screen.getByLabelText("Amount you paid")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount paid by Anna")).toBeInTheDocument();
  });

  it("is Toi in French", () => {
    renderSheet({}, { locale: "fr" });

    const payers = within(
      screen.getByRole("radiogroup", { name: "Payé par" }),
    ).getAllByRole("radio");
    expect(payers[0]).toHaveAccessibleName("Payé par toi");
    expect(payers[0]).toHaveTextContent("Toi");
    expect(
      screen.getByRole("button", { name: "T’inclure dans le partage" }),
    ).toBeInTheDocument();
  });
});
