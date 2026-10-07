import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { RecurringTable, type RecurringRowView } from "./recurring-table";

/**
 * The recurring expenses as a table, the way a desk reads them.
 *
 * The rows are the phone's rows, already worded on the server; what is worth
 * asserting here is that the table says everything the phone's row says, in
 * the same words, with a column for "when" — and that a paused rule says it is
 * paused in the column a reader scans for the next date, rather than showing
 * a date that will not come.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock("@/modules/recurring/actions", () => ({
  deleteRecurringAction: vi.fn(async () => ({ ok: true })),
  restoreRecurringAction: vi.fn(async () => ({ ok: true })),
  setRecurringPausedAction: vi.fn(async () => ({ ok: true })),
}));

const CLEANING: RecurringRowView = {
  id: "r1",
  description: "Apartment cleaning",
  amount: "6500",
  currency: "EUR",
  schedule: "Every week on Saturday",
  next: "15 Aug 2026",
  paused: false,
  generatedCount: 1,
};

const SURF: RecurringRowView = {
  id: "r2",
  description: "Surf school pass",
  amount: "8000",
  currency: "EUR",
  schedule: "Every week on Thursday",
  next: null,
  paused: true,
  generatedCount: 0,
};

function render(rows: readonly RecurringRowView[], canEdit = true) {
  return renderWithIntl(
    <RecurringTable rows={rows} groupId="g1" canEdit={canEdit} />,
  );
}

/** A row's cells, by the column header they sit under. */
function cellsOf(description: string): Record<string, HTMLElement> {
  const table = screen.getByRole("table", { name: "Recurring expenses" });
  const headers = within(table)
    .getAllByRole("columnheader")
    .map((header) => header.textContent ?? "");
  const row = within(table).getByText(description).closest("tr") as HTMLElement;
  const cells = within(row).getAllByRole("cell");
  return Object.fromEntries(
    headers.map((header, index) => [header, cells[index]]),
  );
}

describe("the recurring table", () => {
  it("heads a column for each thing the phone's row says", () => {
    render([CLEANING]);

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Description", "Repeats", "Amount", "Next", "Actions"]);
  });

  it("gives a running rule its schedule, its amount and its next date", () => {
    render([CLEANING]);
    const cells = cellsOf("Apartment cleaning");

    expect(cells.Repeats).toHaveTextContent("Every week on Saturday");
    expect(cells.Amount).toHaveTextContent("€65.00");
    // The column is headed Next, so the date stands bare in it.
    expect(cells.Next).toHaveTextContent("15 Aug 2026");
    expect(cells.Next).not.toHaveTextContent("Next:");
    expect(cells.Next).toHaveTextContent("1 generated so far");
    expect(
      within(cells.Description).queryByText("Paused"),
    ).not.toBeInTheDocument();
  });

  it("says a paused rule is paused where the next date would be", () => {
    render([CLEANING, SURF]);
    const cells = cellsOf("Surf school pass");

    expect(within(cells.Description).getByText("Paused")).toBeInTheDocument();
    expect(cells.Next).toHaveTextContent("Paused — nothing will be generated");
    expect(cells.Amount).toHaveTextContent("€80.00");
  });

  it("folds the schedule and the next date under the name, in the phone's words", () => {
    render([CLEANING]);
    const { Description } = cellsOf("Apartment cleaning");

    // Shown by the container query only while the table is too narrow for
    // the two columns; the words are the phone's own.
    expect(Description).toHaveTextContent(
      "Every week on Saturday · Next: 15 Aug 2026 · 1 generated so far",
    );
  });

  it("offers each row the phone's menu, named for its row", async () => {
    const user = userEvent.setup();
    render([CLEANING, SURF]);

    await user.click(
      screen.getByRole("button", { name: "Actions for Surf school pass" }),
    );
    const items = await screen.findAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Edit",
      "Resume",
      "Delete",
    ]);
    expect(items[0]).toHaveAttribute("href", "/groups/g1/recurring/r2/edit");
  });

  it("leaves Edit out where the phone's menu leaves it out", async () => {
    const user = userEvent.setup();
    render([CLEANING], false);

    await user.click(
      screen.getByRole("button", { name: "Actions for Apartment cleaning" }),
    );
    await screen.findByRole("menuitem", { name: "Pause" });
    expect(
      screen.queryByRole("menuitem", { name: "Edit" }),
    ).not.toBeInTheDocument();
  });

  it("counts what is running and what is paused at its foot", () => {
    const { unmount } = render([CLEANING, { ...CLEANING, id: "r3" }, SURF]);
    expect(screen.getByText("2 running · 1 paused")).toBeInTheDocument();
    expect(
      screen.getByText(/The ones it has already added stay as they are/),
    ).toBeInTheDocument();
    unmount();

    render([CLEANING]);
    expect(screen.getByText("1 running")).toBeInTheDocument();
  });

  it("says the same in French", () => {
    renderWithIntl(
      <RecurringTable rows={[CLEANING, SURF]} groupId="g1" canEdit />,
      { locale: "fr" },
    );

    expect(
      screen.getAllByRole("columnheader").map((header) => header.textContent),
    ).toEqual(["Description", "Récurrence", "Montant", "Prochaine", "Actions"]);
    expect(screen.getByText("1 en cours · 1 suspendue")).toBeInTheDocument();
  });
});
