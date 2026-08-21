import { describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AddEntryDrawer } from "./add-entry-drawer";

/**
 * What the screen does, from the outside.
 *
 * These assert the behaviours the rework is *for*: the amount is typed into
 * the figure itself, the split is one row until you open it, an empty split
 * stays empty, the type switch keeps what it can and drops what it must, and
 * the primary button says what it will do.
 *
 * Rendered as the drawer rather than as the bare form, because that is what
 * ships — the title, the close and the one footer button are all part of the
 * sheet, and a form tested outside one would not have them.
 *
 * Server actions are mocked. Whether an expense is stored correctly is the
 * service layer's problem and is tested there; this is about the form.
 */

const {
  createExpense,
  createSettlement,
  createRecurring,
  updateExpense,
  updateSettlement,
  toSettlement,
  toExpense,
  deleteExpense,
  deleteSettlement,
  upload,
  success,
  push,
  back,
} = vi.hoisted(() => ({
  createExpense: vi.fn(),
  createSettlement: vi.fn(),
  createRecurring: vi.fn(),
  updateExpense: vi.fn(),
  updateSettlement: vi.fn(),
  toSettlement: vi.fn(),
  toExpense: vi.fn(),
  deleteExpense: vi.fn(),
  deleteSettlement: vi.fn(),
  upload: vi.fn(),
  success: vi.fn(),
  push: vi.fn(),
  back: vi.fn(),
}));

vi.mock("@/modules/expenses/actions", () => ({
  createExpenseAction: createExpense,
  createSettlementAction: createSettlement,
  updateExpenseAction: updateExpense,
  updateSettlementAction: updateSettlement,
  convertExpenseToSettlementAction: toSettlement,
  convertSettlementToExpenseAction: toExpense,
  deleteExpenseAction: deleteExpense,
  deleteSettlementAction: deleteSettlement,
}));
vi.mock("@/modules/recurring/actions", () => ({
  createRecurringAction: createRecurring,
}));
vi.mock("@/components/expenses/upload-receipt", () => ({
  uploadReceipt: upload,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, back, refresh: vi.fn() }),
}));
// The confirmation is a toast now, and a toast needs a `<Toaster />` mounted
// somewhere above it to render. What matters here is that it was raised, and
// with what.
vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => success(...args), error: vi.fn() },
}));
// The classifier reaches for a web worker and WebAssembly; neither exists in
// jsdom, and none of these tests are about categorisation.
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

function renderForm(
  overrides: Partial<Parameters<typeof AddEntryDrawer>[0]> = {},
) {
  // Module mocks are shared across the file; without this a "was not called"
  // assertion would be reading the previous test's call.
  for (const action of [
    createExpense,
    createSettlement,
    createRecurring,
    updateExpense,
    updateSettlement,
    toSettlement,
    toExpense,
    deleteExpense,
    deleteSettlement,
    upload,
    success,
    push,
    back,
  ]) {
    action.mockClear();
  }

  createExpense.mockResolvedValue({ ok: true, data: { expenseId: "e1" } });
  createSettlement.mockResolvedValue({
    ok: true,
    data: { settlementId: "s1" },
  });
  createRecurring.mockResolvedValue({ ok: true, data: { id: "r1" } });
  updateExpense.mockResolvedValue({ ok: true, data: undefined });
  updateSettlement.mockResolvedValue({ ok: true, data: undefined });
  toSettlement.mockResolvedValue({ ok: true, data: { settlementId: "s2" } });
  toExpense.mockResolvedValue({ ok: true, data: { expenseId: "e2" } });
  deleteExpense.mockResolvedValue({ ok: true, data: undefined });
  deleteSettlement.mockResolvedValue({ ok: true, data: undefined });
  upload.mockResolvedValue({
    ok: true,
    file: { id: "att-1", fileName: "bill.pdf" },
  });

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

/** Types an amount into the figure, one character at a time. */
async function enterAmount(
  user: ReturnType<typeof userEvent.setup>,
  digits: string,
  label = "Amount",
) {
  await user.type(screen.getByRole("textbox", { name: label }), digits);
}

/** The sheet that is open over the drawer, by its own title. */
function sheet(name: string) {
  return within(screen.getByRole("dialog", { name }));
}

/** Opens the split editor from the summary row. */
async function openSplit(
  user: ReturnType<typeof userEvent.setup>,
  who = /Seb paid/,
) {
  await user.click(screen.getByRole("button", { name: who }));
}

/**
 * The attach control's own input.
 *
 * It is deliberately `aria-hidden` — the button beside it is the control a
 * reader gets — so there is no accessible name to find it by.
 */
function fileInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>('input[type="file"]');
  if (!input) throw new Error("no file input on the form");
  return input;
}

describe("the drawer", () => {
  it("marks the description field with a decorative glyph", () => {
    renderForm();

    const description = screen.getByRole("textbox", { name: "Description" });
    const glyph = description.previousElementSibling;

    expect(glyph?.tagName).toBe("svg");
    expect(glyph).toHaveAttribute("aria-hidden", "true");
  });

  it("is titled by what it is about to add", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(
      screen.getByRole("heading", { name: "Add expense" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    expect(
      screen.getByRole("heading", { name: "Settle up" }),
    ).toBeInTheDocument();
  });

  /** One way forward, and the ways out cost no room: X, scrim, swipe. */
  it("carries one primary button and no Cancel", () => {
    renderForm();

    expect(
      screen.getByRole("button", { name: "Add expense" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
  });

  it("closes from the X", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByRole("heading", { name: "Add expense" }),
    ).not.toBeInTheDocument();
  });

  /**
   * That the drawer keeps two independent limits on its height.
   *
   * jsdom does no layout, so what is checked here is what reaches the element
   * rather than what it measures — which is the part that has broken twice.
   * A height is one declaration: an engine that cannot parse any piece of it
   * drops the whole thing and leaves the sheet at its content's height, and a
   * sheet anchored to the bottom edge grows off the *top*, taking its close
   * button with it. So the backstop must say the same thing without the two
   * newest pieces, `dvh` and `min()`, and both must survive the class merge —
   * a height added to `SheetContent`'s own base classes would otherwise
   * silently eat the one passed in here.
   */
  it("limits its height twice, and the backstop needs no modern units", () => {
    renderForm();
    const classes = screen.getByRole("dialog").className.split(" ");

    const height = classes.find((name) => name.startsWith("h-["));
    const backstop = classes.find((name) => name.startsWith("max-h-["));

    // Both leave the island its room, or the header sits underneath it.
    expect(height).toContain("env(safe-area-inset-top)");
    expect(backstop).toContain("env(safe-area-inset-top)");

    expect(backstop).not.toContain("dvh");
    expect(backstop).not.toContain("min(");
  });
});

describe("the default expense path", () => {
  it("takes an amount and shows the computed share", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");

    // The row states the split as a sentence, with the per-person figure.
    expect(screen.getByText(/Seb paid/)).toBeInTheDocument();
    expect(
      screen.getByText(/Split equally between 3 · CHF 28\.20 each/),
    ).toBeInTheDocument();
  });

  it("will not save until there is an amount", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
    await enterAmount(user, "20");
    expect(
      screen.getByRole("button", { name: "Add expense" }),
    ).not.toBeDisabled();
  });

  it("records the entry as spending", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(createExpense).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        direction: "out",
        description: "Dinner",
        amount: "8460",
        currency: "CHF",
      }),
    );
    expect(success).toHaveBeenCalledWith("Expense added", expect.anything());
  });

  it("asks for a description before saving", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(createExpense).not.toHaveBeenCalled();
    expect(
      screen.getByText("Give this entry a description."),
    ).toBeInTheDocument();
  });
});

describe("the split sheet", () => {
  it("opens from the summary row and closes again", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");

    await openSplit(user);
    expect(
      screen.getByRole("heading", { name: "Payment and split" }),
    ).toBeInTheDocument();

    await user.click(
      sheet("Payment and split").getByRole("button", { name: "Done" }),
    );
    expect(
      screen.queryByRole("heading", { name: "Payment and split" }),
    ).not.toBeInTheDocument();
  });

  it("drops someone from the split and re-divides", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await openSplit(user);

    const split = sheet("Payment and split");
    await user.click(
      split.getByRole("button", { name: "Include Cyril in the split" }),
    );
    await user.click(split.getByRole("button", { name: "Done" }));

    expect(
      screen.getByText(/Split equally between 2 · CHF 42\.30 each/),
    ).toBeInTheDocument();
  });

  it("offers per-person inputs only on the methods that need them", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await openSplit(user);

    const split = sheet("Payment and split");
    expect(split.queryByLabelText("Shares for Seb")).not.toBeInTheDocument();
    await user.click(split.getByRole("button", { name: "Shares" }));
    expect(split.getByLabelText("Shares for Seb")).toBeInTheDocument();
  });

  it("keeps split rows the same height in every method", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await openSplit(user);

    const split = sheet("Payment and split");
    for (const method of ["Equally", "Shares", "Exact", "Percent"]) {
      await user.click(split.getByRole("button", { name: method }));
      for (const row of split.getAllByRole("listitem")) {
        expect(row).toHaveClass("h-15");
      }
    }
  });

  /** Who paid is one of many, and reports itself as such. */
  it("offers the payer as a choice rather than three toggles", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await openSplit(user);

    const payer = sheet("Payment and split").getByRole("radio", {
      name: "Paid by Hervé",
    });
    expect(payer).toHaveAttribute("aria-checked", "false");
    await user.click(payer);
    expect(payer).toHaveAttribute("aria-checked", "true");
  });

  /** Money that came in was received and credited; nobody paid it. */
  it("speaks of receiving and crediting on an income", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    await openSplit(user, /Seb received/);

    const split = sheet("Income and split");
    expect(
      screen.getByRole("heading", { name: "Income and split" }),
    ).toBeInTheDocument();
    expect(split.getByText("Received by")).toBeInTheDocument();
    expect(split.getByText("Credited to")).toBeInTheDocument();
    expect(split.queryByText("Paid by")).not.toBeInTheDocument();
    expect(
      split.getByRole("radio", { name: "Received by Hervé" }),
    ).toBeInTheDocument();
  });
});

/**
 * The state the old form refused to have.
 *
 * Deselecting everybody used to silently put everyone back, which is the kind
 * of help that loses work: the person doing it was halfway through choosing
 * two of five. It is now a real state that simply cannot be saved.
 */
describe("an empty split", () => {
  async function emptyTheSplit(user: ReturnType<typeof userEvent.setup>) {
    await enterAmount(user, "84.60");
    await openSplit(user);
    const split = sheet("Payment and split");
    for (const member of MEMBERS) {
      await user.click(
        split.getByRole("button", {
          name: `Include ${member.displayName} in the split`,
        }),
      );
    }
    return split;
  }

  it("stays empty, and says what to do about it", async () => {
    const user = userEvent.setup();
    renderForm();
    const split = await emptyTheSplit(user);

    expect(
      split.getByText("Pick at least one person to split this with."),
    ).toBeInTheDocument();
    expect(split.getByRole("button", { name: "Done" })).toBeDisabled();
  });

  it("cannot be saved", async () => {
    const user = userEvent.setup();
    renderForm();
    await emptyTheSplit(user);

    // Back out of the sheet the only way an empty split allows.
    await user.keyboard("{Escape}");
    expect(
      screen.queryByRole("heading", { name: "Payment and split" }),
    ).not.toBeInTheDocument();

    expect(screen.getByText("Nobody selected yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
  });
});

describe("the split note", () => {
  it("says which way exact amounts are out, and by how much", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await openSplit(user);

    const split = sheet("Payment and split");
    await user.click(split.getByRole("button", { name: "Exact" }));

    // Seeded from an equal split, so it starts balanced.
    expect(split.queryByText(/still to assign/)).not.toBeInTheDocument();

    await user.clear(split.getByLabelText("Exact amount for Cyril"));
    expect(split.getByText("CHF 28.20 still to assign.")).toBeInTheDocument();

    await user.type(split.getByLabelText("Exact amount for Cyril"), "40");
    expect(split.getByText("CHF 11.80 over the total.")).toBeInTheDocument();
  });
});

describe("attaching a file", () => {
  it("uploads on choosing, and links it to the saved entry", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.upload(
      fileInput(),
      new File(["x"], "bill.pdf", { type: "application/pdf" }),
    );

    expect(upload).toHaveBeenCalledWith("g1", expect.anything(), "bill.pdf");
    expect(await screen.findByText("bill.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Add expense" }));
    expect(createExpense).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ attachmentIds: ["att-1"] }),
    );
  });

  it("says so when the upload fails, and saves nothing behind it", async () => {
    const user = userEvent.setup();
    renderForm();
    upload.mockResolvedValue({ ok: false, reason: "offline" });

    await enterAmount(user, "84.60");
    await user.upload(
      fileInput(),
      new File(["x"], "bill.pdf", { type: "application/pdf" }),
    );

    expect(
      await screen.findByText(
        "The upload failed. Check your connection and try again.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("bill.pdf")).not.toBeInTheDocument();
  });

  /** A repayment has no attachment column, so the upload must not survive. */
  it("drops what was attached when the entry becomes a settlement", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.upload(
      fileInput(),
      new File(["x"], "bill.pdf", { type: "application/pdf" }),
    );
    expect(await screen.findByText("bill.pdf")).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    await user.click(screen.getByRole("tab", { name: "Expense" }));

    expect(screen.queryByText("bill.pdf")).not.toBeInTheDocument();
  });
});

describe("income", () => {
  it("credits everyone, and records the entry as money in", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    await enterAmount(user, "2400", "Amount received");
    await user.type(screen.getByLabelText("Description"), "Rent");
    await user.click(screen.getByRole("button", { name: "Add income" }));

    expect(createExpense).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ direction: "in", amount: "240000" }),
    );
    expect(success).toHaveBeenCalledWith("Income added", expect.anything());
  });

  /** "Mine only" is an entry that moves nobody — so there is nothing to split. */
  it("hides the split row when the income is credited to one person", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByText(/Seb received/)).toBeInTheDocument();

    await user.click(screen.getByRole("radio", { name: /Mine only/ }));
    expect(screen.queryByText(/Seb received/)).not.toBeInTheDocument();
  });
});

describe("switching type", () => {
  it("keeps the amount, which is the expensive thing to retype", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.click(screen.getByRole("tab", { name: "Income" }));

    expect(
      screen.getByRole("textbox", { name: "Amount received" }),
    ).toHaveValue("84.60");
  });

  it("turns recurrence off when a settlement cannot have it", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("switch", { name: "Repeats" }));
    expect(screen.getByRole("switch", { name: "Repeats" })).toBeChecked();

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    await user.click(screen.getByRole("tab", { name: "Expense" }));
    expect(screen.getByRole("switch", { name: "Repeats" })).not.toBeChecked();
  });
});

describe("settlement", () => {
  it("starts from a real debt and prefills its amount", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Settle" }));

    expect(screen.getByText("Hervé owes Seb")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Paying back" })).toHaveValue(
      "128.40",
    );
  });

  /**
   * A group that keeps its currencies separate has no base to pin a repayment
   * to, and the debt is denominated anyway — in whatever it was run up in.
   */
  it("takes its currency from the debt, not from the group", async () => {
    const user = userEvent.setup();
    renderForm({
      currencyMode: "separate",
      baseCurrency: null,
      defaultCurrency: "CHF",
      outstanding: [
        { ...OUTSTANDING[0], currency: "EUR", amountMinor: "4000" },
      ],
    });

    await user.click(screen.getByRole("tab", { name: "Settle" }));

    expect(screen.getByRole("textbox", { name: "Paying back" })).toHaveValue(
      "40.00",
    );
    expect(screen.getByText("EUR")).toBeInTheDocument();
  });

  it("offers the methods that country actually uses", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));

    // Europe/Zurich → Switzerland → TWINT.
    expect(screen.getByText("Switzerland")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /TWINT/ })).toBeInTheDocument();
  });

  it("records the payment with the method it was made by", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));
    await user.click(screen.getByRole("button", { name: /TWINT/ }));
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(createSettlement).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        fromParticipantId: "herve",
        toParticipantId: "seb",
        amount: "12840",
        paymentMethod: "TWINT",
      }),
    );
    expect(success).toHaveBeenCalledWith("Payment recorded", expect.anything());
  });

  /**
   * How the money moved is optional, and the row used to answer it on the
   * reader's behalf: the country's first suggestion arrived lit up, so every
   * repayment saved without a thought said "TWINT".
   */
  it("records no method when nobody chose one", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));

    expect(screen.getByRole("button", { name: /TWINT/ })).toHaveAttribute(
      "aria-pressed",
      "false",
    );

    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(createSettlement).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ paymentMethod: "" }),
    );
  });

  /**
   * The debt names the currency, which is right nearly always and was enforced
   * as always: cash handed back in whatever was in the wallet had nowhere to
   * go.
   */
  it("lets the currency be changed away from the debt's", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));

    await user.click(screen.getByRole("button", { name: "CHF" }));
    await user.click(sheet("Currency").getByRole("button", { name: /^EUR/ }));

    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(createSettlement).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ currency: "EUR" }),
    );
  });

  it("takes what the repayment was for, and saves it with the payment", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));

    await user.type(
      screen.getByRole("textbox", { name: "Description (optional)" }),
      "Bus tickets",
    );
    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(createSettlement).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ notes: "Bus tickets" }),
    );
  });

  /**
   * The point of the field: most repayments are for everything at once, and
   * being stopped to invent a title for one is how it goes unrecorded.
   */
  it("records a repayment nobody described, rather than asking for one", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));

    await user.click(screen.getByRole("button", { name: "Record payment" }));

    expect(createSettlement).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ notes: "" }),
    );
  });

  it("keeps a description off the expense tabs, which have no room for one", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    expect(
      screen.getByRole("textbox", { name: "Description (optional)" }),
    ).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "Expense" }));
    expect(
      screen.queryByRole("textbox", { name: "Description (optional)" }),
    ).toBeNull();
  });

  it("says so when there is nothing outstanding", async () => {
    const user = userEvent.setup();
    renderForm({ outstanding: [] });

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    expect(screen.getByText("Everyone is settled up.")).toBeInTheDocument();
  });
});

describe("recurrence", () => {
  it("changes the button to say what will actually be saved", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");

    expect(
      screen.getByRole("button", { name: "Add expense" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("switch", { name: "Repeats" }));

    expect(
      screen.getByRole("button", { name: "Save recurring expense" }),
    ).toBeInTheDocument();
  });

  /** The switch turns it on; the rule row is what opens the editor. */
  it("shows the rule, and opens the sheet from it", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByText(/^Monthly/)).not.toBeInTheDocument();
    await user.click(screen.getByRole("switch", { name: "Repeats" }));

    await user.click(screen.getByRole("button", { name: /Monthly/ }));
    expect(screen.getByRole("heading", { name: "Repeat" })).toBeInTheDocument();
  });

  it("writes a template rather than a single entry", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await user.type(screen.getByLabelText("Description"), "Cleaning");

    await user.click(screen.getByRole("switch", { name: "Repeats" }));
    await user.click(
      screen.getByRole("button", { name: "Save recurring expense" }),
    );

    expect(createRecurring).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({
        direction: "out",
        description: "Cleaning",
        frequency: "monthly",
      }),
    );
    expect(createExpense).not.toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(
      "Recurring entry saved",
      expect.anything(),
    );
  });
});

describe("after saving", () => {
  /**
   * The drawer gets out of the way and says so from outside it, rather than
   * holding the group behind a confirmation screen.
   */
  it("says what was saved, and leaves", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    expect(success).toHaveBeenCalledWith("Expense added", {
      description: expect.stringMatching(/^Dinner · CHF.84\.60$/),
    });
    expect(
      screen.queryByRole("button", { name: "Add expense" }),
    ).not.toBeInTheDocument();
  });
});

describe("the amount field", () => {
  /**
   * The native keyboard will happily offer a fourth character after "1.23";
   * what stops it is the field refusing to hold one, not the keyboard.
   */
  it("refuses a third decimal in a two-decimal currency", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "1.239");

    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("1.23");
  });

  /** The keyboard's own decimal key is a comma across most of Europe. */
  it("takes a comma for the decimal separator", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84,60");

    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue(
      "84.60",
    );
  });

  /**
   * Yen has no minor unit. An amount already typed as francs has to be brought
   * with the new currency's rules rather than left as something the server
   * would only refuse at save time.
   */
  it("re-reads what is typed against a newly chosen currency", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "1200.50");
    await user.click(screen.getByRole("button", { name: "CHF" }));

    // Picking is the whole interaction: there is nothing to confirm after it.
    await user.click(sheet("Currency").getByRole("button", { name: /^JPY/ }));

    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("1200");
  });

  /**
   * The list is one screen for the whole app, so it is the alphabet plus
   * whatever this reader has starred — not a per-group reordering. A group's
   * own currency earns its place by being the one already chosen, which the
   * row says with a check and a tint wherever it sits.
   */
  it("marks the currency already chosen", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "CHF" }));

    const chosen = sheet("Currency").getByRole("button", { name: /^CHF/ });
    expect(chosen).toHaveAttribute("aria-current", "true");
  });

  /**
   * Search is the way past a hundred and fifty rows, and it has to reach the
   * ones nobody knows the code of. Accents are not typed on a phone keyboard
   * in a hurry, so they cannot be required either.
   */
  it("finds a currency by its country, accents and all", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "CHF" }));

    const currency = sheet("Currency");
    await user.type(
      currency.getByRole("textbox", { name: "Search a currency" }),
      "united states",
    );

    expect(currency.getByRole("button", { name: /^USD/ })).toBeInTheDocument();
    expect(currency.queryByRole("button", { name: /^JPY/ })).toBeNull();
  });

  /** Starring is not choosing: it must not pick the row it is sitting in. */
  it("keeps a star from selecting the currency it belongs to", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "CHF" }));

    const currency = sheet("Currency");
    await user.click(
      currency.getByRole("button", { name: "Add JPY to favourites" }),
    );

    // Still open, and still on the currency it came in with.
    expect(
      currency.getByRole("button", { name: "Remove JPY from favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
    expect(currency.getByRole("button", { name: /^CHF/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });
});

describe("payment method marks", () => {
  /**
   * Balancia ships no provider artwork. An operator who has the right to
   * display a logo drops it into `public/payment-methods/`, and until then the
   * lettermark stands in — so the row must render either way, and must never
   * show a broken image while it finds out.
   */
  it("falls back to a lettermark, and looks for an operator-supplied logo", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("tab", { name: "Settle" }));

    const twint = screen.getByRole("button", { name: /TWINT/ });
    // The lettermark is what is painted until a logo actually loads.
    expect(twint).toHaveTextContent("T");

    const logo = twint.querySelector("img");
    expect(logo).toHaveAttribute("src", "/payment-methods/twint.svg");
    // Decorative: the button already carries the method's name.
    expect(logo).toHaveAttribute("alt", "");
    expect(logo).toHaveStyle({ opacity: "0" });
  });
});

describe("the category picker", () => {
  /** An entry to reopen, so the edit flow can be exercised on a real pair. */
  const EDITABLE_EXPENSE = {
    kind: "expense" as const,
    id: "e1",
    type: "expense" as const,
    amountText: "84.60",
    currency: "CHF",
    exchangeRate: "",
    date: "2026-08-12",
    description: "Migros",
    category: "groceries",
    subcategory: "",
    notes: "",
    payerId: "herve",
    settleTo: null,
    includedIds: ["seb", "herve"],
    splitMethod: "equal" as const,
    splitValues: {},
    paymentMethod: "",
  };

  /**
   * Changing the parent clears the child.
   *
   * `fuel` is not a subcategory of `restaurants`, and carrying it across would
   * leave a pair the server refuses and the reader never chose. The form is
   * not what guarantees this — `expenseInputSchema` is — but it is where a
   * person would see it go wrong.
   */
  it("drops the subcategory when the category changes under it", async () => {
    const user = userEvent.setup();
    renderForm();

    const row = () => screen.getByRole("button", { name: /Category/ });

    await user.click(row());
    await user.click(screen.getByRole("button", { name: /^Transport/ }));
    await user.click(screen.getByRole("button", { name: "Fuel" }));
    expect(row()).toHaveTextContent("Transport");
    expect(row()).toHaveTextContent("Fuel");

    await user.click(row());
    await user.click(screen.getByRole("button", { name: /^Restaurants/ }));
    await user.click(screen.getByRole("button", { name: /^Just Restaurants/ }));

    expect(row()).toHaveTextContent("Restaurants");
    expect(row()).not.toHaveTextContent("Fuel");
  });

  it("reopens an entry on the pair it was saved with", async () => {
    const user = userEvent.setup();
    renderForm({
      editing: { ...EDITABLE_EXPENSE, category: "home", subcategory: "rent" },
    });

    const row = screen.getByRole("button", { name: /Category/ });
    expect(row).toHaveTextContent("Home");
    expect(row).toHaveTextContent("Rent");

    // And the child can be taken off again without touching the parent. The
    // sheet always opens at the root, so the pane is one tap away.
    await user.click(row);
    await user.click(screen.getByRole("button", { name: /^Home/ }));
    await user.click(screen.getByRole("button", { name: "Just Home" }));
    expect(row).toHaveTextContent("Home");
    expect(row).not.toHaveTextContent("Rent");
  });

  it("leaves an entry with no subcategory reading as complete", () => {
    renderForm({
      editing: { ...EDITABLE_EXPENSE, category: "home", subcategory: "" },
    });

    const row = screen.getByRole("button", { name: /Category/ });
    expect(row).toHaveTextContent("Home");
    // Never a placeholder for the missing half: "no subcategory" would make an
    // ordinary entry look unfinished.
    expect(row).not.toHaveTextContent("Not specified");
  });

  /**
   * A dialog focuses its first control when it opens, which in this sheet is
   * the search field — and on a phone that is a keyboard over the shortlist,
   * before anybody has said they want to search.
   */
  it("opens on the chips rather than in the search field", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /Category/ }));

    const search = screen.getByRole("textbox", { name: "Search categories" });
    expect(search).not.toHaveFocus();
    // Focus still has to be inside the dialog, or nothing can be tabbed
    // through and Escape has nothing to close.
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );

    // And it is still a search field the moment somebody wants one.
    await user.type(search, "lodg");
    expect(search).toHaveFocus();
    expect(
      screen.getByRole("button", { name: /^Lodging/ }),
    ).toBeInTheDocument();
  });
});

describe("the currency picker", () => {
  it("shows the selected currency's flag in the amount chip", () => {
    renderForm();

    const currency = screen.getByRole("button", { name: "CHF" });
    expect(within(currency).getByText("🇨🇭")).toBeInTheDocument();
  });

  /** The same rule as the category sheet: the list first, the keyboard later. */
  it("opens on the currency list rather than in the search field", async () => {
    const user = userEvent.setup();
    renderForm();

    // The pill beside the amount, not the currency's own row.
    await user.click(screen.getAllByRole("button", { name: /CHF/ })[0]);

    const search = screen.getByRole("textbox", {
      name: "Search a currency",
    });
    expect(search).not.toHaveFocus();
    expect(screen.getByRole("dialog").contains(document.activeElement)).toBe(
      true,
    );

    await user.type(search, "yen");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: /^JPY/ })).toBeInTheDocument();
  });
});

/**
 * Reopening an entry, which is the same screen with something already in it.
 *
 * The point of the rework is that nothing here is edit-only: the tabs, the
 * category picker and the currency list are the ones adding gets, and the only
 * differences are what saving does and the two things an entry that already
 * happened cannot become.
 */
describe("editing an entry", () => {
  const EXPENSE = {
    kind: "expense" as const,
    id: "e1",
    type: "expense" as const,
    amountText: "84.60",
    currency: "CHF",
    exchangeRate: "",
    date: "2026-08-12",
    description: "Migros",
    category: "groceries",
    subcategory: "",
    notes: "Weekly shop",
    payerId: "herve",
    settleTo: null,
    includedIds: ["seb", "herve"],
    splitMethod: "equal" as const,
    splitValues: {},
    paymentMethod: "",
  };

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
    paymentMethod: "TWINT",
  };

  const save = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: "Save changes" }));
  };

  it("opens on the entry it was given", () => {
    renderForm({ editing: EXPENSE });

    expect(screen.getByRole("dialog", { name: "Edit expense" })).toBeVisible();
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue(
      "84.60",
    );
    expect(screen.getByRole("textbox", { name: "Description" })).toHaveValue(
      "Migros",
    );
    // The payer and the two people in the split, not the group's three.
    expect(
      screen.getByRole("button", { name: /Hervé paid/ }),
    ).toHaveTextContent("2");
  });

  it("saves an untouched entry as the update it is", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await save(user);

    expect(createExpense).not.toHaveBeenCalled();
    expect(updateExpense).toHaveBeenCalledTimes(1);
    const [groupId, expenseId, payload] = updateExpense.mock.calls[0];
    expect(groupId).toBe("g1");
    expect(expenseId).toBe("e1");
    expect(payload).toMatchObject({
      direction: "out",
      description: "Migros",
      amount: "8460",
      // No expense tab can show notes; what it cannot show it must not drop.
      notes: "Weekly shop",
    });
  });

  it("turns an expense into income without leaving the screen", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await user.click(screen.getByRole("tab", { name: "Income" }));
    await save(user);

    expect(updateExpense).toHaveBeenCalledTimes(1);
    expect(updateExpense.mock.calls[0][2]).toMatchObject({
      direction: "in",
      description: "Migros",
    });
  });

  it("moves an expense to the settlements table when it was a repayment", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    // The payer carries over as the one paying; who they repaid is the one
    // thing an expense cannot say, so it has to be picked.
    expect(screen.getByRole("radio", { name: "From: Hervé" })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "To: Seb" }));
    await save(user);

    expect(updateExpense).not.toHaveBeenCalled();
    expect(toSettlement).toHaveBeenCalledTimes(1);
    const [groupId, expenseId, payload] = toSettlement.mock.calls[0];
    expect(groupId).toBe("g1");
    expect(expenseId).toBe("e1");
    expect(payload).toMatchObject({
      fromParticipantId: "herve",
      toParticipantId: "seb",
      // The reader's own figure, not the outstanding debt's: they are saying
      // this entry was a repayment, not that it was that repayment.
      amount: "8460",
    });
  });

  it("reopens a settlement on its own pair and its own method", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    expect(screen.getByRole("dialog", { name: "Edit payment" })).toBeVisible();
    await save(user);

    expect(createSettlement).not.toHaveBeenCalled();
    expect(updateSettlement).toHaveBeenCalledTimes(1);
    const [groupId, settlementId, payload] = updateSettlement.mock.calls[0];
    expect(groupId).toBe("g1");
    expect(settlementId).toBe("s1");
    expect(payload).toMatchObject({
      fromParticipantId: "herve",
      toParticipantId: "seb",
      amount: "12840",
      // Read back from the stored label rather than replaced by whatever this
      // country's first method happens to be.
      paymentMethod: "TWINT",
    });
  });

  it("reopens a repayment on the words it was recorded with", async () => {
    const user = userEvent.setup();
    renderForm({ editing: { ...SETTLEMENT, notes: "Bus tickets" } });

    const note = screen.getByRole("textbox", {
      name: "Description (optional)",
    });
    expect(note).toHaveValue("Bus tickets");

    await user.clear(note);
    await user.type(note, "Train tickets");
    await save(user);

    expect(updateSettlement.mock.calls[0][2]).toMatchObject({
      notes: "Train tickets",
    });
  });

  it("moves a settlement back to the expenses table", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    await user.click(screen.getByRole("tab", { name: "Expense" }));
    await user.type(
      screen.getByRole("textbox", { name: "Description" }),
      "Concert tickets",
    );
    await save(user);

    expect(updateSettlement).not.toHaveBeenCalled();
    expect(toExpense).toHaveBeenCalledTimes(1);
    const [groupId, settlementId, payload] = toExpense.mock.calls[0];
    expect(groupId).toBe("g1");
    expect(settlementId).toBe("s1");
    expect(payload).toMatchObject({
      direction: "out",
      description: "Concert tickets",
      amount: "12840",
    });
  });

  it("does not offer to repeat something that already happened", () => {
    renderForm({ editing: EXPENSE });

    expect(screen.queryByRole("switch", { name: "Repeats" })).toBeNull();
  });

  it("offers to remove the entry, once it has been confirmed", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await user.click(screen.getByRole("button", { name: "Delete this entry" }));
    expect(deleteExpense).not.toHaveBeenCalled();

    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );
    expect(deleteExpense).toHaveBeenCalledWith("g1", "e1");
  });

  it("removes a settlement from its own table", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    await user.click(screen.getByRole("button", { name: "Delete this entry" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    expect(deleteExpense).not.toHaveBeenCalled();
    expect(deleteSettlement).toHaveBeenCalledWith("g1", "s1");
  });

  it("has no delete and no update when the entry is new", () => {
    renderForm();

    expect(
      screen.queryByRole("button", { name: "Delete this entry" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Add expense" })).toBeVisible();
  });
});

/**
 * Where the drawer goes when it closes.
 *
 * `dismissTo="back"` is the intercepted route's way out, and it is right for
 * everything that leaves the entry where it was. It is wrong for the two things
 * that do not: a deletion and a change of type across the two tables both take
 * the screen behind the drawer with them, and popping onto it lands on a 404.
 */
describe("leaving the drawer", () => {
  const EXPENSE = {
    kind: "expense" as const,
    id: "e1",
    type: "expense" as const,
    amountText: "84.60",
    currency: "CHF",
    exchangeRate: "",
    date: "2026-08-12",
    description: "Migros",
    category: "",
    subcategory: "",
    notes: "",
    payerId: "seb",
    settleTo: null,
    includedIds: ["seb", "herve"],
    splitMethod: "equal" as const,
    splitValues: {},
    paymentMethod: "",
  };

  it("goes back after an edit that left the entry where it was", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => expect(back).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });

  it("goes to the group after a deletion", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await user.click(screen.getByRole("button", { name: "Delete this entry" }));
    await user.click(
      within(screen.getByRole("alertdialog")).getByRole("button", {
        name: "Delete",
      }),
    );

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/groups/g1"));
    expect(back).not.toHaveBeenCalled();
  });

  it("goes to the group after a change of type moved the entry", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    await user.click(screen.getByRole("radio", { name: "To: Hervé" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await vi.waitFor(() => expect(push).toHaveBeenCalledWith("/groups/g1"));
    expect(back).not.toHaveBeenCalled();
  });

  /**
   * *When* it leaves, which for a moved entry is not a matter of taste.
   *
   * The Server Action that moved it re-renders `/expenses/<id>/edit` on its
   * way back, and that route loads the expense which is no longer there. A
   * departure held for the slide-out arrives after the 404 the route answered,
   * and the reader is stranded on the not-found screen. So the action is held
   * open here and released by hand: nothing but microtasks runs between the
   * result arriving and the assertion, and it has already gone.
   */
  it("leaves the moment the entry moved, without waiting for the slide-out", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });
    const moved = held(toSettlement);

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    await user.click(screen.getByRole("radio", { name: "To: Hervé" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(push).not.toHaveBeenCalled();

    await act(async () => moved({ ok: true, data: { settlementId: "s2" } }));

    expect(push).toHaveBeenCalledWith("/groups/g1");
    expect(back).not.toHaveBeenCalled();
  });

  /** An entry still in place has a screen behind it, so that one does wait. */
  it("holds an ordinary edit until the drawer has slid away", async () => {
    const user = userEvent.setup();
    renderForm({ editing: EXPENSE });
    const saved = held(updateExpense);

    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await act(async () => saved({ ok: true, data: undefined }));

    expect(back).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(back).toHaveBeenCalled());
    expect(push).not.toHaveBeenCalled();
  });
});

/**
 * Stops an action mid-flight and hands back the handle that finishes it.
 *
 * Timing is the assertion in the two tests above, and neither the clock nor
 * fake timers can carry it: real time makes them a race against however loaded
 * the machine is, and faking it deadlocks a tree this deep. Releasing the
 * result by hand inside `act` leaves microtasks as the only thing that has
 * run, which is exactly the window the drawer has to leave in.
 */
function held(action: ReturnType<typeof vi.fn>) {
  let release!: (result: unknown) => void;
  action.mockReturnValue(
    new Promise((resolve) => {
      release = resolve;
    }),
  );
  return release;
}

/**
 * Who is repaying whom, when the answer is not one of the group's debts.
 *
 * The outstanding list is the right way into a new repayment and the wrong way
 * to change one: a recorded settlement has already cleared the debt it was for,
 * so its own pair is never in that list, and correcting a wrong name means
 * naming somebody who never owed anything.
 */
describe("picking the people on a repayment", () => {
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
    paymentMethod: "TWINT",
  };

  it("offers the whole group on both sides, not just its debts", () => {
    renderForm({ editing: SETTLEMENT });

    expect(screen.queryByText("Outstanding")).toBeNull();
    for (const name of ["Seb", "Hervé", "Cyril"]) {
      expect(
        screen.getByRole("radio", { name: `From: ${name}` }),
      ).toBeVisible();
      expect(screen.getByRole("radio", { name: `To: ${name}` })).toBeVisible();
    }
    expect(screen.getByRole("radio", { name: "From: Hervé" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "To: Seb" })).toBeChecked();
  });

  it("keeps each side to one person", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    await user.click(screen.getByRole("radio", { name: "To: Cyril" }));

    expect(screen.getByRole("radio", { name: "To: Cyril" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "To: Seb" })).not.toBeChecked();
    // The other side is untouched by a choice on this one.
    expect(screen.getByRole("radio", { name: "From: Hervé" })).toBeChecked();
  });

  /** Naming the person who holds the other side can only mean reversing it. */
  it("swaps the two rather than putting one person on both sides", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    await user.click(screen.getByRole("radio", { name: "From: Seb" }));

    expect(screen.getByRole("radio", { name: "From: Seb" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "To: Hervé" })).toBeChecked();
  });

  it("saves the people it was given, debt or no debt", async () => {
    const user = userEvent.setup();
    renderForm({ editing: SETTLEMENT });

    // Cyril owes nobody in OUTSTANDING, which is exactly the point.
    await user.click(screen.getByRole("radio", { name: "To: Cyril" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(updateSettlement).toHaveBeenCalledTimes(1);
    expect(updateSettlement.mock.calls[0][2]).toMatchObject({
      fromParticipantId: "herve",
      toParticipantId: "cyril",
      amount: "12840",
    });
  });

  it("cannot be saved until both sides are named", async () => {
    const user = userEvent.setup();
    renderForm({
      editing: {
        ...SETTLEMENT,
        kind: "expense" as const,
        id: "e1",
        type: "expense" as const,
        description: "Migros",
        settleTo: null,
      },
    });

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    expect(screen.getByRole("button", { name: "Save changes" })).toBeDisabled();

    await user.click(screen.getByRole("radio", { name: "To: Seb" }));
    expect(
      screen.getByRole("button", { name: "Save changes" }),
    ).not.toBeDisabled();
  });

  /** Adding one still starts from a debt: that is what makes it one tap. */
  it("still leads a new repayment with what is outstanding", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Settle" }));

    expect(screen.getByText("Outstanding")).toBeVisible();
    expect(screen.queryByRole("radio", { name: "From: Seb" })).toBeNull();
  });
});
