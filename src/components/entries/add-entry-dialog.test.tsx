import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AddEntryDrawer } from "./add-entry-drawer";

/**
 * The entry drawer on a desk, where it is a dialog.
 *
 * From `lg` the same form lays its parts out side by side: the type tabs in
 * the title row, the split on the form rather than behind a row, the category
 * and the currency in popovers on the rows that open them, and ⌘↵ to save.
 * Everything else it does is `add-entry-form.test.tsx`'s, which runs at a
 * phone's width — the width jsdom reports unless told otherwise — and must
 * not notice any of this.
 *
 * Server actions are mocked; whether an entry is stored correctly is the
 * service layer's problem.
 */

const { createExpense, back } = vi.hoisted(() => ({
  createExpense: vi.fn(),
  back: vi.fn(),
}));

vi.mock("@/modules/expenses/actions", () => ({
  createExpenseAction: createExpense,
  createSettlementAction: vi.fn(),
  updateExpenseAction: vi.fn(),
  updateSettlementAction: vi.fn(),
  convertExpenseToSettlementAction: vi.fn(),
  convertSettlementToExpenseAction: vi.fn(),
  deleteExpenseAction: vi.fn(),
  deleteSettlementAction: vi.fn(),
  restoreExpenseAction: vi.fn(),
  restoreSettlementAction: vi.fn(),
}));
vi.mock("@/modules/recurring/actions", () => ({
  createRecurringAction: vi.fn(),
  updateRecurringAction: vi.fn(),
}));
vi.mock("@/lib/offline/outbox", () => ({ enqueueEntry: vi.fn() }));
vi.mock("@/components/expenses/upload-receipt", () => ({
  uploadReceipt: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back,
    refresh: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The classifier reaches for a web worker and WebAssembly, neither of which
// jsdom has.
vi.mock("@/components/expenses/use-category-suggestion", () => ({
  useCategorySuggestion: () => null,
}));

const MEMBERS = [
  { id: "seb", displayName: "Seb" },
  { id: "herve", displayName: "Hervé" },
  { id: "cyril", displayName: "Cyril" },
];

const OUTSTANDING = [
  {
    fromParticipantId: "herve",
    fromName: "Hervé",
    toParticipantId: "seb",
    toName: "Seb",
    amountMinor: "12840",
    currency: "CHF",
    amountFormatted: "CHF 128.40",
  },
];

let matchMedia: typeof window.matchMedia;

/** A window from `lg` up: the one width query the dialog asks answers yes. */
function atDesk(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide && query === "(min-width: 64rem)",
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

beforeEach(() => {
  matchMedia = window.matchMedia;
  atDesk(true);
  createExpense.mockReset();
  createExpense.mockResolvedValue({ ok: true, data: { expenseId: "e1" } });
  back.mockReset();
});

afterEach(() => {
  window.matchMedia = matchMedia;
});

function renderDialog(
  overrides: Partial<Parameters<typeof AddEntryDrawer>[0]> = {},
  url = "/groups/g1/expenses/new",
) {
  window.history.replaceState(null, "", url);
  return renderWithIntl(
    <AddEntryDrawer
      dismissTo="back"
      groupId="g1"
      members={MEMBERS}
      selfId="seb"
      currencyMode="converted"
      baseCurrency="CHF"
      defaultCurrency="CHF"
      timezone="Europe/Zurich"
      outstanding={OUTSTANDING}
      {...overrides}
    />,
  );
}

async function fillIn(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByRole("textbox", { name: "Amount" }), "42");
  await user.type(
    screen.getByRole("textbox", { name: "Description" }),
    "Groceries",
  );
}

describe("the entry dialog on a desk", () => {
  it("puts the kinds of entry in the title's row", () => {
    renderDialog();

    const title = screen.getByRole("heading", { name: "Add expense" });
    const row = title.parentElement as HTMLElement;
    expect(within(row).getByRole("tablist")).toBeInTheDocument();
    expect(within(row).getByRole("tab", { name: "Expense" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  it("lays the split out on the form, with no row to open first", async () => {
    const user = userEvent.setup();
    renderDialog();

    // The phone's summary row is not there; its sheet's contents are.
    expect(
      screen.queryByRole("button", { name: /^Paid by/ }),
    ).not.toBeInTheDocument();
    const payers = screen.getByRole("radiogroup", { name: "Paid by" });
    expect(
      within(payers).getByRole("radio", { name: "Paid by you" }),
    ).toBeChecked();

    // And it is the split: leaving somebody out is one press on the form.
    await user.click(
      screen.getByRole("button", { name: "Include Cyril in the split" }),
    );
    expect(
      screen.getByRole("button", { name: "Include Cyril in the split" }),
    ).toHaveAttribute("aria-pressed", "false");
    // No sheet was raised to do it, so nothing was left to close.
    expect(screen.queryByRole("button", { name: "Done" })).toBeNull();
  });

  it("names every split method in full, beside its hint", () => {
    renderDialog();

    expect(
      screen.getByRole("button", { name: "Equally", pressed: true }),
    ).toHaveTextContent("Equally");
    expect(
      screen.getByText("Split evenly between everyone selected."),
    ).toBeInTheDocument();
  });

  it("opens the categories in a popover on the row", async () => {
    const user = userEvent.setup();
    renderDialog();

    const row = screen.getByRole("button", { name: /Category/ });
    await user.click(row);

    expect(row).toHaveAttribute("aria-expanded", "true");
    const popover = document.querySelector('[data-slot="popover-content"]');
    expect(popover).not.toBeNull();
    // Its title is a heading of its own, not a second name for the dialog.
    expect(
      within(popover as HTMLElement).getByRole("heading", {
        name: "Category",
      }),
    ).not.toHaveAttribute("id");
  });

  it("opens the currencies in a popover on the chip, searching", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "CHF" }));

    const search = screen.getByRole("textbox", { name: "Search a currency" });
    expect(search).toHaveFocus();
    await user.type(search, "yen");
    await user.click(screen.getByRole("button", { name: /^JPY/ }));

    expect(screen.getByRole("button", { name: "JPY" })).toBeInTheDocument();
    expect(document.querySelector('[data-slot="popover-content"]')).toBeNull();
  });

  describe("saving from the keyboard", () => {
    it("saves on ⌘↵ from any field", async () => {
      const user = userEvent.setup();
      renderDialog();
      await fillIn(user);

      await user.keyboard("{Meta>}{Enter}{/Meta}");

      await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
      expect(createExpense).toHaveBeenCalledWith(
        "g1",
        expect.objectContaining({ description: "Groceries", amount: "4200" }),
        expect.any(String),
      );
    });

    it("takes Ctrl ↵ off a Mac", async () => {
      const user = userEvent.setup();
      renderDialog();
      await fillIn(user);

      await user.keyboard("{Control>}{Enter}{/Control}");

      await waitFor(() => expect(createExpense).toHaveBeenCalledTimes(1));
    });

    it("does nothing the button would not do", async () => {
      const user = userEvent.setup();
      renderDialog();

      await user.type(screen.getByRole("textbox", { name: "Amount" }), "42");
      await user.keyboard("{Meta>}{Enter}{/Meta}");

      expect(screen.getByRole("button", { name: "Add expense" })).toBeEnabled();
      // Enabled, but empty of a description: the press is the button's, and
      // the button would refuse and say why.
      await waitFor(() =>
        expect(
          screen.getByRole("textbox", { name: "Description" }),
        ).toHaveFocus(),
      );
      expect(createExpense).not.toHaveBeenCalled();
    });

    it("says the key on the button, and beside it", () => {
      renderDialog();

      expect(
        screen.getByRole("button", { name: "Add expense" }),
      ).toHaveAttribute("aria-keyshortcuts", "Meta+Enter Control+Enter");
      expect(screen.getByText("to save", { exact: false })).toBeInTheDocument();
    });
  });

  it("offers Cancel beside the button, which closes it", async () => {
    const user = userEvent.setup();
    renderDialog();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
  });

  it("closes on Esc, leaving the screen behind where it was", async () => {
    const user = userEvent.setup();
    renderDialog();
    await fillIn(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(back).toHaveBeenCalledTimes(1));
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("lets Esc close the new person's name field and not the dialog", async () => {
    const user = userEvent.setup();
    renderDialog({ canAddGuests: true });

    await user.click(screen.getByRole("button", { name: "Add someone" }));
    const name = screen.getByRole("textbox", { name: "Add someone" });
    await user.type(name, "Léa");
    await user.keyboard("{Escape}");

    expect(
      screen.queryByRole("textbox", { name: "Add someone" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Add expense" }),
    ).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(back).not.toHaveBeenCalled();
  });
});

describe("a repayment on a desk", () => {
  it("says the currency the two end up square in, and what recording is", () => {
    renderDialog(
      {},
      "/groups/g1/expenses/new#settleFrom=herve&settleTo=seb&settleIn=CHF&settleVia=cash",
    );

    expect(
      screen.getByText("Hervé and Seb will be settled in CHF."),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Balancia only records the repayment. It never moves the money itself.",
      ),
    ).toBeInTheDocument();
  });

  it("opens on the tab with nobody picked, from Settle up's link", () => {
    renderDialog({}, "/groups/g1/expenses/new#type=settle");

    expect(screen.getByRole("tab", { name: "Repayment" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Hervé pays you back/ }),
    ).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("Pick who is paying whom.")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Record repayment" }),
    ).toBeDisabled();
  });
});

describe("below lg", () => {
  it("is the drawer as it was: the split behind its row, no Cancel", () => {
    atDesk(false);
    renderDialog();

    expect(screen.getByRole("button", { name: /^Paid by/ })).toBeVisible();
    expect(screen.queryByRole("radiogroup", { name: "Paid by" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Add expense" }),
    ).not.toHaveAttribute("aria-keyshortcuts");
  });
});
