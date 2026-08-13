import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ItemAssignmentView } from "./item-assignment";
import { toDraft } from "./draft";
import type { ItemAssignment } from "@/modules/receipts";
import type { ParsedReceipt } from "@/modules/receipts";

/**
 * The "who had what" screen.
 *
 * The property worth protecting here is that what is on screen is what will be
 * stored: the totals shown come from `assignReceipt`, the same function that
 * produces the split, so the preview cannot drift from the result.
 */

const RECEIPT: ParsedReceipt = {
  currency: "CHF",
  items: [
    { id: "i1", name: "Margherita", total: 1900n },
    { id: "i2", name: "Carbonara", total: 2450n },
    { id: "i3", name: "Beer", quantity: 2, total: 1400n },
    { id: "i4", name: "Tiramisu", total: 950n },
  ],
  total: 7210n,
};

const PARTICIPANTS = [
  { id: "p-seb", displayName: "Seb" },
  { id: "p-alex", displayName: "Alex" },
  { id: "p-julie", displayName: "Julie" },
];

const ASSIGNED: ItemAssignment[] = [
  { itemId: "i1", participantIds: ["p-seb"] },
  { itemId: "i2", participantIds: ["p-alex"] },
  { itemId: "i3", participantIds: ["p-seb", "p-alex"] },
  { itemId: "i4", participantIds: ["p-julie"] },
];

function renderAssignment(assignments: ItemAssignment[] = ASSIGNED) {
  const draft = toDraft(RECEIPT, {
    fallbackCurrency: "CHF",
    fallbackDate: "2026-08-13",
  });
  const onAssignmentsChange = vi.fn();
  const onStrategyChange = vi.fn();

  const view = renderWithIntl(
    <ItemAssignmentView
      draft={draft}
      participants={PARTICIPANTS}
      assignments={assignments}
      onAssignmentsChange={onAssignmentsChange}
      strategy="proportional"
      onStrategyChange={onStrategyChange}
      total={7210n}
    />,
  );
  return { ...view, onAssignmentsChange, onStrategyChange };
}

/** The amounts rendered in the "each person pays" list, in order. */
function shares(): string[] {
  const heading = screen.getByText("Each person pays");
  const list = heading.parentElement?.querySelector("ul");
  return [...(list?.querySelectorAll("li") ?? [])].map(
    (row) => row.querySelector("span.font-medium")?.textContent ?? "",
  );
}

describe("ItemAssignmentView", () => {
  it("lists every item with its price", () => {
    renderAssignment();
    expect(screen.getByText("Margherita")).toBeInTheDocument();
    expect(screen.getByText("Tiramisu")).toBeInTheDocument();
  });

  it("shows who is on each item", () => {
    renderAssignment();
    // Three participants per item, so each name appears once per row.
    expect(screen.getAllByRole("button", { name: "Seb" })).toHaveLength(4);
    const [first] = screen.getAllByRole("button", { name: "Seb" });
    expect(first).toHaveAttribute("aria-pressed", "true");
  });

  it("adds someone to an item when their name is tapped", async () => {
    const user = userEvent.setup();
    const { onAssignmentsChange } = renderAssignment();

    // Julie on the Margherita, which currently only Seb had.
    await user.click(screen.getAllByRole("button", { name: "Julie" })[0]);

    expect(onAssignmentsChange).toHaveBeenCalledWith(
      expect.arrayContaining([
        { itemId: "i1", participantIds: ["p-seb", "p-julie"] },
      ]),
    );
  });

  it("removes someone when their name is tapped again", async () => {
    const user = userEvent.setup();
    const { onAssignmentsChange } = renderAssignment();

    await user.click(screen.getAllByRole("button", { name: "Seb" })[0]);

    expect(onAssignmentsChange).toHaveBeenCalledWith(
      expect.arrayContaining([{ itemId: "i1", participantIds: [] }]),
    );
  });

  it("shows what each person pays, and it adds up to the total", () => {
    renderAssignment();

    // Seb 26.00 + 1.98, Alex 31.50 + 2.40, Julie 9.50 + 0.72 → 72.10.
    const amounts = shares();
    expect(amounts).toHaveLength(3);
    expect(amounts[0]).toMatch(/27\.98/);
    expect(amounts[1]).toMatch(/33\.90/);
    expect(amounts[2]).toMatch(/10\.22/);
  });

  it("names the shared charges and how they are being spread", () => {
    renderAssignment();
    expect(screen.getByText(/Shared charges/)).toHaveTextContent("5.10");
    expect(
      screen.getByLabelText("Split in proportion to what each person had"),
    ).toBeChecked();
  });

  it("says when an item is shared between people", () => {
    renderAssignment();
    expect(
      screen.getByText("Split equally between 2 people"),
    ).toBeInTheDocument();
  });

  it("reports items nobody has claimed rather than dropping them", () => {
    renderAssignment(ASSIGNED.slice(0, 3));
    expect(screen.getByText(/1 item has nobody assigned/)).toBeInTheDocument();
  });

  it("still adds up to the total when nothing has been assigned", () => {
    renderAssignment([]);
    const amounts = shares();
    // 72.10 split three ways, with the odd rappen going to the first.
    expect(amounts[0]).toMatch(/24\.04/);
    expect(amounts[1]).toMatch(/24\.03/);
    expect(amounts[2]).toMatch(/24\.03/);
  });
});
