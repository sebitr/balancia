import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { numberFormatSample, numberLocale } from "@/i18n/format";
import { formatMoney } from "@/modules/currencies/money";
import { MoneyFormats, type PreviewEntry } from "./money-formats";

/**
 * How dates and numbers are written, and the line that proves it.
 *
 * Two chip rows saved by one action, but they are two decisions: changing one
 * must not lose the other, and neither says a word when it lands. The preview
 * rewrote itself on the tap and the chip that was replaced is still in the row,
 * so a toast would only sit on top of the line it was confirming. A refused
 * write puts its row back, because a chip left showing a choice the account did
 * not keep is the one thing this screen must not do.
 *
 * The display currency is the exception the same file makes on purpose: it is
 * chosen through a sheet of 165 entries, so putting it back is a journey rather
 * than a second tap, and that one still confirms itself with an Undo.
 *
 * The chips are radios, each named by the notation it produces — which is also
 * the only thing the reader has to go on, and therefore worth asserting on
 * rather than routing around. What the old cards could not be asked is the
 * question this screen exists to answer: whether the reader's own amount is
 * rewritten on the tap, before anything has been saved.
 */

const {
  setFormatPreferencesAction,
  setPreferredCurrencyAction,
  toastUndoable,
} = vi.hoisted(() => ({
  setFormatPreferencesAction: vi.fn(),
  setPreferredCurrencyAction: vi.fn(),
  toastUndoable: vi.fn(),
}));

vi.mock("@/modules/profile/actions", () => ({
  setFormatPreferencesAction,
  setPreferredCurrencyAction,
}));
vi.mock("@/components/ui/sonner", () => ({ toastUndoable, UNDO_WINDOW: 8000 }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const ENTRY: PreviewEntry = {
  description: "Airbnb Zermatt",
  amount: "248000",
  currency: "CHF",
  expenseDate: "2026-08-13",
};

function renderFormats(entry: PreviewEntry | null = ENTRY) {
  setFormatPreferencesAction.mockReset();
  setFormatPreferencesAction.mockResolvedValue({ ok: true });
  setPreferredCurrencyAction.mockReset();
  setPreferredCurrencyAction.mockResolvedValue({ ok: true });
  toastUndoable.mockReset();
  const view = renderWithIntl(
    <MoneyFormats entry={entry} converted={entry} currency="CHF" />,
  );
  return { ...view, user: userEvent.setup() };
}

const row = (label: string) =>
  within(screen.getByRole("radiogroup", { name: label }));

/**
 * Every chip names itself with the notation it produces — so the expectations
 * are asked of the same formatter the chips are, rather than transcribed. A
 * grouping space here is U+202F, and an ICU release that moves it should
 * change what this test looks for, not break it.
 */
const DMY = "13/08/2026";
const DOT_COMMA = numberFormatSample("dot-comma", "en");
const SPACE_COMMA = numberFormatSample("space-comma", "en");

/**
 * 2480 CHF, written the way a chip promises to write it — then flattened the
 * way the DOM query will flatten the rendered text. `space-comma` groups with
 * U+202F, and testing-library's default normaliser turns every run of
 * whitespace into one plain space before it compares, so a query holding the
 * narrow one matches nothing.
 */
const amountIn = (format: "auto" | "space-comma") =>
  formatMoney(
    { amount: 248000n, currency: "CHF" },
    { locale: numberLocale(format, "en"), display: "none" },
  ).replace(/\s/g, " ");

describe("MoneyFormats", () => {
  it("writes a choice as it is made, and says nothing about it", async () => {
    const { user } = renderFormats();

    await user.click(row("Dates").getByRole("radio", { name: DMY }));

    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenCalledWith({
        dateFormat: "dmy",
        numberFormat: "auto",
      }),
    );
    expect(row("Dates").getByRole("radio", { name: DMY })).toBeChecked();
    expect(toastUndoable).not.toHaveBeenCalled();
  });

  it("puts a chip row back from the chip it replaced", async () => {
    const { user } = renderFormats();

    await user.click(row("Dates").getByRole("radio", { name: DMY }));
    await waitFor(() =>
      expect(row("Dates").getByRole("radio", { name: "Auto" })).toBeEnabled(),
    );
    await user.click(row("Dates").getByRole("radio", { name: "Auto" }));

    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenLastCalledWith({
        dateFormat: "auto",
        numberFormat: "auto",
      }),
    );
    expect(row("Dates").getByRole("radio", { name: DMY })).not.toBeChecked();
    expect(toastUndoable).not.toHaveBeenCalled();
  });

  it("does not lose the other row's choice when one is changed", async () => {
    const { user } = renderFormats();

    await user.click(row("Numbers").getByRole("radio", { name: DOT_COMMA }));
    await waitFor(() =>
      expect(
        row("Numbers").getByRole("radio", { name: DOT_COMMA }),
      ).toBeChecked(),
    );

    await user.click(row("Dates").getByRole("radio", { name: DMY }));

    // One action writes both, so the second write has to carry the first
    // choice forward rather than sending the value the page was loaded with.
    await waitFor(() =>
      expect(setFormatPreferencesAction).toHaveBeenLastCalledWith({
        dateFormat: "dmy",
        numberFormat: "dot-comma",
      }),
    );
  });

  it("puts the row back when the write is refused", async () => {
    const { user } = renderFormats();
    setFormatPreferencesAction.mockResolvedValue({ ok: false });

    await user.click(row("Dates").getByRole("radio", { name: DMY }));

    await waitFor(() =>
      expect(row("Dates").getByRole("radio", { name: DMY })).not.toBeChecked(),
    );
    expect(toastUndoable).not.toHaveBeenCalled();
  });

  it("rewrites the reader's own amount on the tap, before anything is saved", async () => {
    const { user } = renderFormats();
    // Never resolves, so nothing below can be the round trip having finished.
    setFormatPreferencesAction.mockReturnValue(new Promise(() => {}));

    expect(screen.getByText(amountIn("auto"))).toBeInTheDocument();
    expect(screen.getByText("Airbnb Zermatt")).toBeInTheDocument();

    await user.click(row("Numbers").getByRole("radio", { name: SPACE_COMMA }));

    // The same 2480, in the notation just chosen — narrow no-break space and
    // a comma, which is exactly what the chip promised.
    await waitFor(() =>
      expect(screen.getByText(amountIn("space-comma"))).toBeInTheDocument(),
    );
  });

  it("rewrites the date on the tap too", async () => {
    const { user } = renderFormats();

    await user.click(row("Dates").getByRole("radio", { name: "2026-08-13" }));

    await waitFor(() =>
      // The meta line, not just the chip that was pressed.
      expect(screen.getAllByText("2026-08-13")).toHaveLength(2),
    );
  });

  it("shows an example, and says so, for an account with nothing yet", () => {
    renderFormats(null);

    expect(screen.getByText("an example, as it will read")).toBeInTheDocument();
    // The currency control lives in this card, so the card cannot be the
    // thing that disappears when there is no entry to preview.
    expect(
      screen.getByRole("button", { name: /Show my totals in/ }),
    ).toBeInTheDocument();
  });
});
