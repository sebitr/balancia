import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ReceiptReview } from "./receipt-review";
import { toDraft } from "./draft";
import type { ParsedReceipt } from "@/modules/receipts";

/**
 * What the review screen promises: everything the scanner proposed is here,
 * everything is editable, and the warnings follow the fields rather than the
 * original scan.
 */

const SCANNED: ParsedReceipt = {
  merchant: "Casa Italia",
  date: "2026-08-13",
  currency: "CHF",
  items: [
    { id: "i1", name: "Margherita", total: 1900n, confidence: 0.98 },
    { id: "i2", name: "Carbonara", total: 2450n, confidence: 0.61 },
  ],
  subtotal: 4350n,
  tax: 330n,
  total: 4680n,
};

function renderReview(receipt: ParsedReceipt = SCANNED) {
  const draft = toDraft(receipt, {
    fallbackCurrency: "CHF",
    fallbackDate: "2026-08-13",
  });
  const onChange = vi.fn();
  const view = renderWithIntl(
    <ReceiptReview draft={draft} onChange={onChange} />,
  );
  return { ...view, onChange, draft };
}

describe("ReceiptReview", () => {
  it("shows what was read, in editable fields", () => {
    renderReview();

    expect(screen.getByLabelText("Merchant")).toHaveValue("Casa Italia");
    expect(screen.getByLabelText("Date")).toHaveValue("2026-08-13");
    expect(screen.getByLabelText("Name of item 1")).toHaveValue("Margherita");
    expect(screen.getByLabelText("Amount for item 1")).toHaveValue("19.00");
    expect(screen.getByLabelText("Total")).toHaveValue("46.80");
  });

  it("lets the merchant be corrected", async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview();

    await user.type(screen.getByLabelText("Merchant"), "!");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ merchant: "Casa Italia!" }),
    );
  });

  it("lets an item price be corrected", async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview();

    await user.type(screen.getByLabelText("Amount for item 1"), "0");

    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        items: expect.arrayContaining([
          expect.objectContaining({ id: "i1", amount: "19.000" }),
        ]),
      }),
    );
  });

  it("lets an item be removed and another added", async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview();

    await user.click(screen.getByLabelText("Remove Margherita"));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ id: "i2" })],
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add an item" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        items: expect.objectContaining({ length: 3 }),
      }),
    );
  });

  it("does not let the browser fill in an amount", () => {
    // A numeric field with no autocomplete is something Safari and password
    // managers will volunteer values for. Not on a field that decides what
    // somebody pays.
    renderReview();

    const amount = screen.getByLabelText("Amount for item 1");
    expect(amount).toHaveAttribute("autocomplete", "off");
    expect(amount).toHaveAttribute("autocorrect", "off");
  });

  it("keeps what was typed while the field has focus", async () => {
    // The bug this guards: React rewriting a controlled value mid-edit drops
    // the caret to the start on iOS, and the next digit lands at the front —
    // 24.00 becomes 124.00 with nobody typing a 1.
    const user = userEvent.setup();
    renderReview();

    const amount = screen.getByLabelText("Amount for item 1");
    await user.click(amount);
    await user.type(amount, "5");

    // The field shows exactly what was typed, appended, not reordered.
    expect(amount).toHaveValue("19.005");
  });

  it("takes an outside change once the field is no longer being typed into", async () => {
    // The field holds its own text while focused, so a value set from outside
    // still has to land — accepting the suggested total is exactly that.
    // Driven through a stateful parent, the way the dialog drives it.
    function Harness() {
      const [draft, setDraft] = useState(
        toDraft(
          { ...SCANNED, total: undefined },
          { fallbackCurrency: "CHF", fallbackDate: "2026-08-13" },
        ),
      );
      return <ReceiptReview draft={draft} onChange={setDraft} />;
    }

    const user = userEvent.setup();
    renderWithIntl(<Harness />);

    expect(screen.getByLabelText("Total")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Use that" }));
    expect(screen.getByLabelText("Total")).toHaveValue("46.80");
  });

  it("marks a line the recognizer was unsure about, without showing a number", () => {
    renderReview();

    // The second item came back at 0.61 confidence.
    expect(
      screen.getByLabelText("Amount for item 2"),
    ).toHaveAccessibleDescription(/worth checking/i);
    expect(screen.queryByText(/0\.61/)).toBeNull();
    expect(screen.queryByText(/61%/)).toBeNull();
  });

  it("reports numbers that do not reconcile, with the amounts in the message", () => {
    renderReview({ ...SCANNED, tax: 900n });

    const alert = screen.getByText(/do not|does not|but the total says/i);
    expect(alert.textContent).toMatch(/46\.80/);
  });

  it("says nothing when the receipt adds up", () => {
    renderReview();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("offers a total when none was read, rather than filling one in", async () => {
    const user = userEvent.setup();
    const { onChange } = renderReview({ ...SCANNED, total: undefined });

    // The field stays empty until someone accepts the suggestion.
    expect(screen.getByLabelText("Total")).toHaveValue("");

    await user.click(screen.getByRole("button", { name: "Use that" }));
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ total: "46.80" }),
    );
  });
});
