import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { CategoryField } from "./category-field";
import type { ClassificationResult } from "@/modules/categorization";

/**
 * What the field tells the person filling the form.
 *
 * The distinction that matters: a category the classifier was sure about is
 * *filled in* and says so, and one it was not sure about is *offered* and
 * leaves the field empty. Nothing is ever applied behind the user's back, and
 * no confidence number is ever shown.
 */

function result(
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

function renderField(props: Partial<Parameters<typeof CategoryField>[0]> = {}) {
  const onChange = vi.fn();
  const view = renderWithIntl(
    <CategoryField
      value=""
      onChange={onChange}
      suggestion={null}
      detected={false}
      {...props}
    />,
  );
  return { ...view, onChange };
}

describe("CategoryField", () => {
  it("offers every category, with the fallback last", () => {
    renderField();
    const options = screen.getAllByRole("option");
    expect(options[0]).toHaveTextContent("Select a category…");
    expect(options.at(-1)).toHaveTextContent("Other");
    // 15 categories plus the empty placeholder.
    expect(options).toHaveLength(16);
  });

  it("says when it filled the field in itself", () => {
    renderField({
      value: "restaurants",
      detected: true,
      suggestion: result({ category: "restaurants" }),
    });

    expect(screen.getByRole("combobox")).toHaveValue("restaurants");
    expect(screen.getByText("Detected automatically")).toBeInTheDocument();
    // The choice is still the user's to change.
    expect(screen.getByRole("combobox")).toBeEnabled();
  });

  it("offers a shortlist instead of choosing when it is unsure", async () => {
    const { onChange } = renderField({
      suggestion: result({
        decision: "suggested",
        confidence: 0.68,
        category: "shopping",
        alternatives: [
          { category: "restaurants", confidence: 0.61 },
          { category: "groceries", confidence: 0.56 },
        ],
      }),
    });

    expect(screen.getByRole("combobox")).toHaveValue("");
    expect(screen.getByText("Suggestions")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Groceries" }));
    expect(onChange).toHaveBeenCalledWith("groceries");
  });

  it("shows at most three suggestions", () => {
    renderField({
      suggestion: result({
        decision: "suggested",
        category: "shopping",
        alternatives: [
          { category: "restaurants", confidence: 0.6 },
          { category: "groceries", confidence: 0.56 },
          { category: "travel", confidence: 0.55 },
        ],
      }),
    });
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("leaves out a candidate too weak to be worth offering", () => {
    renderField({
      suggestion: result({
        decision: "suggested",
        confidence: 0.68,
        category: "shopping",
        alternatives: [
          { category: "restaurants", confidence: 0.61 },
          // Below the suggestion threshold: a guess, not a candidate.
          { category: "subscriptions", confidence: 0.15 },
        ],
      }),
    });
    expect(
      screen.queryByRole("button", { name: "Subscriptions" }),
    ).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("offers nothing at all when it has no idea", () => {
    renderField({
      suggestion: result({
        decision: "needs_user_input",
        confidence: 0.15,
        alternatives: [{ category: "subscriptions", confidence: 0.15 }],
      }),
    });
    expect(screen.queryByText("Suggestions")).not.toBeInTheDocument();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("never shows a confidence score", () => {
    renderField({
      suggestion: result({ decision: "suggested", category: "shopping" }),
    });
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/0\.\d/)).not.toBeInTheDocument();
  });

  it("keeps an imported category selectable", () => {
    renderField({ value: "Général" });
    expect(screen.getByRole("combobox")).toHaveValue("Général");
    expect(screen.getByText("Imported: Général")).toBeInTheDocument();
  });

  it("speaks the reader's language", () => {
    renderWithIntl(
      <CategoryField
        value="groceries"
        onChange={vi.fn()}
        suggestion={null}
        detected={false}
      />,
      { locale: "fr" },
    );
    expect(screen.getByRole("option", { name: "Courses" })).toBeInTheDocument();
  });
});
