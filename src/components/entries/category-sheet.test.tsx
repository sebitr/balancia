import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { CategorySheet } from "./category-sheet";
import type { ClassificationResult } from "@/modules/categorization";

/**
 * What the picker offers, and what it claims about where the offer came from.
 *
 * The heading over the first few chips is the part worth guarding: "Because it
 * says…" is a statement that the description produced them, and it must not
 * appear over a shortlist assembled from the group's history — that would be
 * the interface citing evidence it does not have.
 */

function classified(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    transactionType: "expense",
    confidence: 0.95,
    decision: "auto_assigned",
    source: "merchant",
    alternatives: [],
    signals: [],
    ...overrides,
  };
}

/**
 * Rendered inside its sheet, because that is the only place it exists: the
 * picker's heading is the dialog's own title, and the two cannot be separated.
 */
function inSheet(props: Partial<Parameters<typeof CategorySheet>[0]>) {
  return (
    <Sheet open>
      <SheetContent side="bottom">
        <CategorySheet
          value=""
          detectedValue=""
          description=""
          suggestion={null}
          frequent={[]}
          onSelect={vi.fn()}
          onRevert={vi.fn()}
          {...props}
        />
      </SheetContent>
    </Sheet>
  );
}

function renderSheet(
  props: Partial<Parameters<typeof CategorySheet>[0]> = {},
  options: { locale?: "en" | "fr" } = {},
) {
  const onSelect = vi.fn();
  const onRevert = vi.fn();
  const view = renderWithIntl(
    inSheet({ onSelect, onRevert, ...props }),
    options,
  );
  return { ...view, onSelect, onRevert };
}

/** The chips under a given heading, by their accessible name. */
function chipsUnder(heading: RegExp | string): string[] {
  const section = screen.getByRole("heading", { name: heading }).parentElement;
  if (!section) throw new Error("heading has no section");
  return within(section)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("CategorySheet", () => {
  it("leads with the guess, and says which words it read", () => {
    renderSheet({
      description: "Dinner at the harbour",
      suggestion: classified({ category: "restaurants" }),
      frequent: ["groceries", "transport"],
      value: "restaurants",
    });

    expect(
      screen.getByRole("heading", { name: /Dinner at the harbour/ }),
    ).toBeInTheDocument();
    expect(chipsUnder(/Dinner at the harbour/)).toEqual([
      "Restaurants & Drinks",
      "Groceries",
      "Transport",
    ]);
  });

  it("cites the group's habit instead when it read nothing", () => {
    renderSheet({ frequent: ["groceries", "restaurants"] });

    expect(
      screen.getByRole("heading", { name: "Most used in this group" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Because it says/)).not.toBeInTheDocument();
  });

  it("offers a shortlisted category once, not twice", () => {
    renderSheet({
      suggestion: classified({ category: "restaurants" }),
      frequent: ["groceries"],
    });

    // Whatever is on the shortlist is taken out of the list below it.
    expect(chipsUnder("All categories")).not.toContain("Restaurants");
    expect(chipsUnder("All categories")).not.toContain("Groceries");
    expect(chipsUnder("All categories")).toContain("Travel");
  });

  it("shows no shortlist at all for a new group with nothing typed", () => {
    renderSheet();

    expect(
      screen.queryByRole("heading", { name: "Most used in this group" }),
    ).not.toBeInTheDocument();
    expect(chipsUnder("All categories")).toContain("Groceries");
  });

  it("picks and closes on one tap, with no Done to press", async () => {
    const { onSelect } = renderSheet({ frequent: ["groceries"] });

    expect(
      screen.queryByRole("button", { name: "Done" }),
    ).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Travel" }));
    expect(onSelect).toHaveBeenCalledExactlyOnceWith("travel");
  });

  it("puts every category behind the search, grouped as results", async () => {
    renderSheet({
      description: "Dinner at the harbour",
      suggestion: classified({ category: "restaurants" }),
      frequent: ["groceries"],
    });

    await userEvent.type(
      screen.getByRole("textbox", { name: "Search categories" }),
      "ies",
    );

    // Searching is someone saying they want something else, so the
    // suggestions stand aside rather than sitting above the answer.
    expect(screen.queryByText(/Because it says/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "All categories" }),
    ).not.toBeInTheDocument();
    // Groceries was on the shortlist and Activities was not; the results are
    // drawn from the whole vocabulary either way, in the reader's own order.
    expect(chipsUnder("Results")).toEqual([
      "Activities",
      "Groceries",
      "Utilities",
    ]);
  });

  it("says so when nothing matches", async () => {
    renderSheet();

    await userEvent.type(
      screen.getByRole("textbox", { name: "Search categories" }),
      "zzz",
    );

    expect(screen.getByText("No category matches.")).toBeInTheDocument();
  });

  /** Accents are expensive on a phone keyboard and should not gate a search. */
  it("finds an accented category without the accent", async () => {
    renderSheet({}, { locale: "fr" });

    await userEvent.type(
      screen.getByRole("textbox", { name: "Rechercher une catégorie" }),
      "sante",
    );

    expect(chipsUnder("Résultats")).toEqual(["Santé"]);
  });

  it("offers the detection back only once it has been overridden", async () => {
    const { onRevert, rerender } = renderSheet({
      detectedValue: "restaurants",
      value: "restaurants",
      suggestion: classified({ category: "restaurants" }),
    });

    expect(
      screen.queryByRole("button", { name: "Back to detected" }),
    ).not.toBeInTheDocument();

    rerender(
      inSheet({
        value: "groceries",
        detectedValue: "restaurants",
        description: "Dinner at the harbour",
        suggestion: classified({ category: "restaurants" }),
        onRevert,
      }),
    );

    await userEvent.click(
      screen.getByRole("button", { name: "Back to detected" }),
    );
    expect(onRevert).toHaveBeenCalledOnce();
  });

  it("marks the current category, and only it", () => {
    renderSheet({ value: "travel", frequent: ["groceries"] });

    expect(screen.getByRole("button", { name: "Travel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Groceries" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });
});
