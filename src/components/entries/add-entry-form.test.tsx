import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AddEntryForm } from "./add-entry-form";

/**
 * What the screen does, from the outside.
 *
 * These assert the behaviours the rework is *for*: the amount comes from a
 * pad, the split is one row until you open it, the type switch keeps what it
 * can and drops what it must, and the primary button says what it will do.
 *
 * Server actions are mocked. Whether an expense is stored correctly is the
 * service layer's problem and is tested there; this is about the form.
 */

const { createExpense, createSettlement, createRecurring, upload } = vi.hoisted(
  () => ({
    createExpense: vi.fn(),
    createSettlement: vi.fn(),
    createRecurring: vi.fn(),
    upload: vi.fn(),
  }),
);

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
    amountFormatted: "CHF 128.40",
  },
];

function renderForm(
  overrides: Partial<Parameters<typeof AddEntryForm>[0]> = {},
) {
  // Module mocks are shared across the file; without this a "was not called"
  // assertion would be reading the previous test's call.
  createExpense.mockClear();
  createSettlement.mockClear();
  createRecurring.mockClear();
  upload.mockClear();

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
    <AddEntryForm
      groupId="g1"
      groupName="Flat 12 · Genève"
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

/** Types an amount through the pad, the way a thumb would. */
async function enterAmount(
  user: ReturnType<typeof userEvent.setup>,
  digits: string,
) {
  await user.click(screen.getByRole("button", { name: /^Amount$/ }));
  for (const key of digits) {
    await user.click(
      screen.getByRole("button", { name: key === "." ? "." : key }),
    );
  }
  await user.click(screen.getByRole("button", { name: "Done" }));
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

describe("the default expense path", () => {
  it("takes an amount from the pad and shows the computed share", async () => {
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
    expect(screen.getByText("Expense added")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /Seb paid/ }));
    expect(
      screen.getByRole("heading", { name: "Payment and split" }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(
      screen.queryByRole("heading", { name: "Payment and split" }),
    ).not.toBeInTheDocument();
  });

  it("drops someone from the split and re-divides", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await user.click(screen.getByRole("button", { name: /Seb paid/ }));

    await user.click(
      screen.getByRole("button", { name: "Include Cyril in the split" }),
    );
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.getByText(/Split equally between 2 · CHF 42\.30 each/),
    ).toBeInTheDocument();
  });

  it("offers per-person inputs only on the methods that need them", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await user.click(screen.getByRole("button", { name: /Seb paid/ }));

    expect(screen.queryByLabelText("Shares for Seb")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Shares" }));
    expect(screen.getByLabelText("Shares for Seb")).toBeInTheDocument();
  });

  /**
   * The pills reach both ends in a tap or two, and the sheet already opens on
   * "everyone" — so two chips restating the selection earned their removal.
   */
  it("has no Everyone or Just me shortcut", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await user.click(screen.getByRole("button", { name: /Seb paid/ }));

    expect(
      screen.queryByRole("button", { name: "Everyone" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Just me" }),
    ).not.toBeInTheDocument();
  });

  /** Money that came in was received and credited; nobody paid it. */
  it("speaks of receiving and crediting on an income", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    await user.click(screen.getByRole("button", { name: /Seb received/ }));

    expect(
      screen.getByRole("heading", { name: "Income and split" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Received by")).toBeInTheDocument();
    expect(screen.getByText("Credited to")).toBeInTheDocument();
    expect(screen.queryByText("Paid by")).not.toBeInTheDocument();
    expect(screen.queryByText("Split between")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Received by Hervé" }),
    ).toBeInTheDocument();
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
    await user.click(screen.getByRole("button", { name: /^Amount received$/ }));
    for (const key of "2400") {
      await user.click(screen.getByRole("button", { name: key }));
    }
    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.type(screen.getByLabelText("Description"), "Rent");
    await user.click(screen.getByRole("button", { name: "Add income" }));

    expect(createExpense).toHaveBeenCalledWith(
      "g1",
      expect.objectContaining({ direction: "in", amount: "240000" }),
    );
    expect(screen.getByText("Income added")).toBeInTheDocument();
  });

  /** "Mine only" is an entry that moves nobody — so there is nothing to split. */
  it("hides the split row when the income is credited to one person", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Income" }));
    expect(screen.getByText(/Seb received/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mine only/ }));
    expect(screen.queryByText(/Seb received/)).not.toBeInTheDocument();
  });
});

describe("switching type", () => {
  it("keeps the amount, which is the expensive thing to retype", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.click(screen.getByRole("tab", { name: "Income" }));

    expect(screen.getByRole("button", { name: /84\.60/ })).toBeInTheDocument();
  });

  it("turns recurrence off when a settlement cannot have it", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /One-off/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));
    expect(screen.getByRole("button", { name: /Monthly/ })).toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Settle" }));
    await user.click(screen.getByRole("tab", { name: "Expense" }));
    expect(screen.getByRole("button", { name: /One-off/ })).toBeInTheDocument();
  });
});

describe("settlement", () => {
  it("starts from a real debt and prefills its amount", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("tab", { name: "Settle" }));

    expect(screen.getByText("Hervé owes Seb")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /128\.40/ })).toBeInTheDocument();
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
    expect(screen.getByText("Payment recorded")).toBeInTheDocument();
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

    await user.click(screen.getByRole("button", { name: /One-off/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));

    expect(
      screen.getByRole("button", { name: "Save recurring expense" }),
    ).toBeInTheDocument();
  });

  it("writes a template rather than a single entry", async () => {
    const user = userEvent.setup();
    renderForm();
    await enterAmount(user, "84.60");
    await user.type(screen.getByLabelText("Description"), "Cleaning");

    await user.click(screen.getByRole("button", { name: /One-off/ }));
    await user.click(screen.getByRole("button", { name: "Done" }));
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
    expect(screen.getByText("Recurring entry saved")).toBeInTheDocument();
  });
});

describe("after saving", () => {
  it("offers another entry, and clears the last one", async () => {
    const user = userEvent.setup();
    renderForm();

    await enterAmount(user, "84.60");
    await user.type(screen.getByLabelText("Description"), "Dinner");
    await user.click(screen.getByRole("button", { name: "Add expense" }));

    await user.click(screen.getByRole("button", { name: "Add another" }));

    expect(screen.getByLabelText("Description")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add expense" })).toBeDisabled();
  });
});

describe("the amount pad", () => {
  it("refuses a third decimal in a two-decimal currency", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByRole("button", { name: /^Amount$/ }));
    for (const key of "1.239") {
      await user.click(
        screen.getByRole("button", { name: key === "." ? "." : key }),
      );
    }

    const keypad = screen.getByRole("dialog");
    expect(within(keypad).getByText("1.23")).toBeInTheDocument();
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
