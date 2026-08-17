import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { SplitDemo } from "./SplitDemo";

describe("SplitDemo", () => {
  it("starts with an exact equal split and a balanced repayment plan", () => {
    renderWithIntl(<SplitDemo />);

    expect(
      screen.getByText("€84.60 ÷ 4 is €21.15 each, exactly."),
    ).toBeVisible();
    expect(screen.getByText(/Settled in \d payments/)).toBeVisible();
  });

  it("shows who receives a largest-remainder cent", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SplitDemo />);

    const amount = screen.getByRole("textbox", { name: "Expense amount" });
    await user.clear(amount);
    await user.type(amount, "84.61");

    expect(
      screen.getByText(
        "€84.61 ÷ 4 leaves 1 cent over. It goes to Sam, and the parts still add to the total.",
      ),
    ).toBeVisible();
  });

  it("reuses weighted allocation for the shares preview", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SplitDemo />);

    await user.click(screen.getByRole("tab", { name: "Shares" }));

    expect(
      screen.getByText(
        "Sam 3 shares, Mina 2, Théo 2, Ada 1 — €31.73 · €21.15 · €21.15 · €10.57.",
      ),
    ).toBeVisible();
  });

  it("moves the live payment when another payer is selected", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SplitDemo />);

    await user.click(screen.getByRole("button", { name: "Ada" }));

    expect(screen.getByText("paid €148.00")).toBeVisible();
  });
});
