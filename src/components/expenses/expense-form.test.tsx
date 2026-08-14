import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ExpenseForm, type ExpenseFormInitialValues } from "./expense-form";

/**
 * The edit form must not change what it was handed.
 *
 * It only knows how to edit spending, and that is fine — but income lives in
 * the same table now, and an edit form that quietly rewrote `direction` would
 * turn "the flat received 2400 rent" into "somebody spent 2400", moving every
 * balance in the group by twice the amount. Nobody would see it happen.
 */

const { updateExpense } = vi.hoisted(() => ({ updateExpense: vi.fn() }));

vi.mock("@/modules/expenses/actions", () => ({
  createExpenseAction: vi.fn(),
  updateExpenseAction: updateExpense,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/components/expenses/use-category-suggestion", () => ({
  useCategorySuggestion: () => null,
}));
// Reaches for OCR models and a worker; irrelevant here and absent in jsdom.
vi.mock("@/components/receipts/scan-receipt-entry", () => ({
  ScanReceiptEntry: () => null,
}));

const PARTICIPANTS = [
  { id: "seb", displayName: "Seb" },
  { id: "herve", displayName: "Hervé" },
];

function initialValues(
  overrides: Partial<ExpenseFormInitialValues> = {},
): ExpenseFormInitialValues {
  return {
    id: "x1",
    direction: "out",
    description: "Dinner",
    notes: "",
    category: "",
    amount: "84.60",
    currency: "EUR",
    exchangeRate: "",
    expenseDate: "2026-08-14",
    splitMethod: "equal",
    payers: [{ participantId: "seb", amount: "8460" }],
    splitEntries: [{ participantId: "seb" }, { participantId: "herve" }],
    ...overrides,
  };
}

async function saveWith(initial: ExpenseFormInitialValues) {
  updateExpense.mockClear();
  updateExpense.mockResolvedValue({ ok: true });
  const user = userEvent.setup();

  renderWithIntl(
    <ExpenseForm
      groupId="g1"
      participants={PARTICIPANTS}
      currencyMode="separate"
      baseCurrency={null}
      defaultCurrency="EUR"
      initial={initial}
    />,
  );

  await user.click(screen.getByRole("button", { name: /Save changes/i }));
  return updateExpense;
}

describe("editing an entry", () => {
  it("keeps an income an income", async () => {
    const action = await saveWith(initialValues({ direction: "in" }));

    expect(action).toHaveBeenCalledWith(
      "g1",
      "x1",
      expect.objectContaining({ direction: "in" }),
    );
  });

  it("leaves spending as spending", async () => {
    const action = await saveWith(initialValues({ direction: "out" }));

    expect(action).toHaveBeenCalledWith(
      "g1",
      "x1",
      expect.objectContaining({ direction: "out" }),
    );
  });
});
