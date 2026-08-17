import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
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

const { createExpense, createSettlement, createRecurring, upload, success } =
  vi.hoisted(() => ({
    createExpense: vi.fn(),
    createSettlement: vi.fn(),
    createRecurring: vi.fn(),
    upload: vi.fn(),
    success: vi.fn(),
  }));

vi.mock("@/modules/expenses/actions", () => ({
  createExpenseAction: createExpense,
  createSettlementAction: createSettlement,
}));
vi.mock("@/modules/recurring/actions", () => ({
  createRecurringAction: createRecurring,
}));
vi.mock("@/components/expenses/upload-receipt", () => ({
  uploadReceipt: upload,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
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
  createExpense.mockClear();
  createSettlement.mockClear();
  createRecurring.mockClear();
  upload.mockClear();
  success.mockClear();

  createExpense.mockResolvedValue({ ok: true, data: { expenseId: "e1" } });
  createSettlement.mockResolvedValue({
    ok: true,
    data: { settlementId: "s1" },
  });
  createRecurring.mockResolvedValue({ ok: true, data: { id: "r1" } });
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
    await user.type(search, "trav");
    expect(search).toHaveFocus();
    expect(screen.getByRole("button", { name: "Travel" })).toBeInTheDocument();
  });
});

describe("the currency picker", () => {
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
