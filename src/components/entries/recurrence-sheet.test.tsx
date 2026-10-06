import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RecurrenceSheet, type RecurrenceState } from "./recurrence-sheet";

const MONTHLY: RecurrenceState = {
  enabled: true,
  frequency: "monthly",
  interval: 1,
  weekday: 1,
  dayOfMonth: 31,
  weekOfMonth: null,
  endDate: null,
  count: null,
};

function renderSheet(
  state: RecurrenceState,
  options: { locale?: "en" | "fr" } = {},
) {
  return renderWithIntl(
    <Sheet open>
      <SheetContent side="bottom">
        <RecurrenceSheet
          state={state}
          onChange={vi.fn()}
          startDate="2026-10-06"
          timezone="Europe/Zurich"
          onDone={vi.fn()}
          onStop={vi.fn()}
        />
      </SheetContent>
    </Sheet>,
    options,
  );
}

/**
 * An end before the first date. The rule is on the 31st and starts on the
 * 6th, so the 20th is after the start and still before the first one.
 */
describe("a rule that ends before its first date", () => {
  it("says so, on the field, and will not be done", async () => {
    const user = userEvent.setup();
    renderSheet({ ...MONTHLY, endDate: "2026-10-20" });

    expect(
      screen.getAllByText("The end date is before the first one."),
    ).not.toHaveLength(0);
    expect(screen.queryByText("That rule never happens.")).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^Ends/ }));
    const field = screen.getByLabelText("On a date");
    expect(field).toHaveAttribute("aria-invalid", "true");
    expect(field).toHaveAccessibleDescription(
      "The end date is before the first one.",
    );
  });

  it("says so in French", () => {
    renderSheet({ ...MONTHLY, endDate: "2026-10-01" }, { locale: "fr" });

    expect(
      screen.getByText("La date de fin tombe avant la première date."),
    ).toBeInTheDocument();
  });

  it("says nothing of the kind once the end is after the first date", () => {
    renderSheet({ ...MONTHLY, endDate: "2026-12-31" });

    expect(
      screen.queryByText("The end date is before the first one."),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeEnabled();
  });
});
