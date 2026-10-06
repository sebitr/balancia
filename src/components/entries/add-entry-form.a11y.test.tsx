import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AddEntryDrawer } from "./add-entry-drawer";

/**
 * The entry drawer, from a keyboard and a screen reader.
 *
 * Kept apart from `add-entry-form.test.tsx`, which is about what the form
 * records: these are about whether somebody who cannot see the screen, or
 * does not use a pointer, can find their way round it — where focus shows,
 * where a refusal is said, and how the choices on it are moved between.
 *
 * Server actions are mocked, as they are there; nothing here reaches a save.
 */

const { createExpense } = vi.hoisted(() => ({ createExpense: vi.fn() }));

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
}));
vi.mock("@/lib/offline/outbox", () => ({ enqueueEntry: vi.fn() }));
vi.mock("@/components/expenses/upload-receipt", () => ({
  uploadReceipt: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
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

const SETTLEMENT = {
  kind: "settlement" as const,
  id: "s1",
  type: "settle" as const,
  amountText: "128.40",
  currency: "CHF",
  exchangeRate: "",
  date: "2026-08-12",
  description: "",
  category: "",
  subcategory: "",
  notes: "",
  payerId: "herve",
  settleTo: "seb",
  includedIds: [] as readonly string[],
  splitMethod: "equal" as const,
  splitValues: {},
  paymentMethod: "",
};

function renderForm(
  overrides: Partial<Parameters<typeof AddEntryDrawer>[0]> = {},
) {
  window.history.replaceState(null, "", "/groups/g1/expenses/new");
  createExpense.mockReset();
  createExpense.mockResolvedValue({ ok: true, data: { expenseId: "e1" } });
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
      outstanding={[]}
      {...overrides}
    />,
  );
}

function sheet(name: string) {
  return within(screen.getByRole("dialog", { name }));
}

/**
 * Where the text fields show focus.
 *
 * The amount, the description and the date are all borderless — the card
 * around each is its edge — and every one of them said `outline-none`, so a
 * keyboard reached them and nothing on screen changed. jsdom does no layout
 * and has no `:focus-visible` to match, so what is pinned is that the ring is
 * asked for on the card, in the variant that only lights it for visible focus.
 */
describe("focus on the borderless fields", () => {
  it("rings the amount's card while the figure has focus", () => {
    renderForm();

    const card = screen
      .getByRole("textbox", { name: "Amount" })
      .closest(".shadow-hairline");
    expect(card?.className).toContain(
      "has-[[data-entry-amount]:focus-visible]:ring-3",
    );
  });

  it("rings the description's card, and the date's", () => {
    renderForm();

    for (const field of [
      screen.getByRole("textbox", { name: "Description" }),
      screen.getByLabelText("Date"),
    ]) {
      const card = field.closest(".shadow-hairline");
      expect(card?.className).toContain("has-[:focus-visible]:ring-3");
      expect(card?.className).toContain("has-[:focus-visible]:ring-ring/50");
    }
  });
});

/**
 * A refused save is said where the reader is.
 *
 * The alert is the first thing in the body and Save the last, so a refusal
 * used to appear a screen above somebody who had scrolled down to save.
 */
describe("a refused save", () => {
  let scrolled: HTMLElement[];
  const original = Element.prototype.scrollIntoView;

  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: HTMLElement) {
      scrolled.push(this);
    };
  });
  afterEach(() => {
    Element.prototype.scrollIntoView = original;
  });

  it("brings the alert into view and the caret to the missing field", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole("textbox", { name: "Amount" }), "84.60");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Give this entry a description.");
    expect(scrolled).toContain(alert);
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveFocus();
    expect(createExpense).not.toHaveBeenCalled();
  });

  it("does it again when the same mistake is pressed twice", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByRole("textbox", { name: "Amount" }), "84.60");
    const save = screen.getByRole("button", { name: "Add expense" });
    await user.click(save);
    await user.click(save);

    const alerts = scrolled.filter(
      (element) => element.getAttribute("role") === "alert",
    );
    expect(alerts).toHaveLength(2);
  });

  it("scrolls without animating for a reader who asked for less motion", async () => {
    const calls: ScrollIntoViewOptions[] = [];
    Element.prototype.scrollIntoView = function (
      options?: boolean | ScrollIntoViewOptions,
    ) {
      if (typeof options === "object") calls.push(options);
    };
    const matchMedia = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      ...matchMedia(query),
      matches: query === "(prefers-reduced-motion: reduce)",
    })) as typeof window.matchMedia;

    try {
      const user = userEvent.setup();
      renderForm();
      await user.type(screen.getByRole("textbox", { name: "Amount" }), "9");
      await user.click(screen.getByRole("button", { name: "Add expense" }));

      expect(calls).toContainEqual({ block: "nearest", behavior: "auto" });
    } finally {
      window.matchMedia = matchMedia;
    }
  });
});

/**
 * The three kinds of entry are real tabs: one Tab stop, the arrows between
 * them, and the form below named by the one that is chosen.
 */
describe("the entry type tabs", () => {
  it("move with the arrows and name the form they switch", async () => {
    const user = userEvent.setup();
    renderForm();

    const expense = screen.getByRole("tab", { name: "Expense" });
    expect(expense).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("tab", { name: "Income" })).toHaveAttribute(
      "tabindex",
      "-1",
    );
    expect(screen.getByRole("tabpanel", { name: "Expense" })).toBeVisible();

    expense.focus();
    await user.keyboard("{ArrowRight}");

    const income = screen.getByRole("tab", { name: "Income" });
    expect(income).toHaveFocus();
    expect(income).toHaveAttribute("aria-selected", "true");
    expect(
      screen.getByRole("heading", { name: "Add income" }),
    ).toBeInTheDocument();
    expect(income).toHaveAttribute(
      "aria-controls",
      screen.getByRole("tabpanel", { name: "Income" }).id,
    );
  });
});

describe("the split sheet's payer", () => {
  it("moves between the faces with the arrows", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "Amount" }), "84.60");
    await user.click(screen.getByRole("button", { name: /^Paid by/ }));

    const split = sheet("Payment and split");
    const seb = split.getByRole("radio", { name: "Paid by you" });
    expect(seb).toHaveAttribute("tabindex", "0");
    seb.focus();
    await user.keyboard("{ArrowRight}");

    const herve = split.getByRole("radio", { name: "Paid by Hervé" });
    expect(herve).toHaveFocus();
    expect(herve).toBeChecked();
    expect(seb).not.toBeChecked();
  });

  /**
   * "Several" turns itself off when pressed again, which no radio does, and
   * inside the radio group it was announced as one more person to pick.
   */
  it("offers several payers as a switch, outside the radio group", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByRole("textbox", { name: "Amount" }), "84.60");
    await user.click(screen.getByRole("button", { name: /^Paid by/ }));

    const split = sheet("Payment and split");
    const several = split.getByRole("button", { name: "Several" });
    expect(several).toHaveAttribute("aria-pressed", "false");
    expect(split.queryByRole("radio", { name: "Several" })).toBeNull();
    expect(
      within(split.getByRole("radiogroup", { name: "Paid by" })).queryByRole(
        "button",
        { name: "Several" },
      ),
    ).toBeNull();

    await user.click(several);
    expect(several).toHaveAttribute("aria-pressed", "true");
  });
});

describe("the recurrence sheet", () => {
  it("is one radio group of presets the arrows move through", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("switch", { name: "Repeats" }));
    await user.click(
      screen.getByRole("button", { name: /Every month on the/ }),
    );

    const repeat = sheet("Repeat");
    const presets = repeat.getByRole("radiogroup", { name: "Repeat" });
    const monthly = within(presets).getByRole("radio", {
      name: /^Every month/,
    });
    expect(monthly).toBeChecked();
    expect(monthly).toHaveAttribute("tabindex", "0");

    monthly.focus();
    await user.keyboard("{ArrowRight}");

    const yearly = within(presets).getByRole("radio", { name: /^Every year/ });
    expect(yearly).toHaveFocus();
    expect(yearly).toBeChecked();
    expect(monthly).not.toBeChecked();
  });
});

describe("the repayment's two sides", () => {
  it("move within a side with the arrows", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    const from = screen.getByRole("radio", { name: "From: Hervé" });
    expect(from).toHaveAttribute("tabindex", "0");
    from.focus();
    await user.keyboard("{ArrowRight}");

    const cyril = screen.getByRole("radio", { name: "From: Cyril" });
    expect(cyril).toHaveFocus();
    expect(cyril).toBeChecked();
    // The other side is untouched: Cyril was nobody's.
    expect(screen.getByRole("radio", { name: "To: Seb" })).toBeChecked();
  });
});
