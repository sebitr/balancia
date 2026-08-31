import { describe, expect, it } from "vitest";
import { expenseInputSchema } from "./schemas";

/**
 * The server-side boundary for the (category, subcategory) pair.
 *
 * The picker clears the child whenever the parent changes, but a form is a
 * convenience and not a guarantee: the API, the importers and the recurring
 * generator all reach the column without going through it.
 */

const base = {
  description: "Petrol",
  amount: "7000",
  currency: "CHF",
  expenseDate: "2026-08-21",
  payers: [
    { participantId: "3f1e5f7a-5f5e-4f6a-9b0e-1c2d3e4f5a6b", amount: "7000" },
  ],
  splitMethod: "equal" as const,
  splitEntries: [{ participantId: "3f1e5f7a-5f5e-4f6a-9b0e-1c2d3e4f5a6b" }],
};

const parse = (overrides: Record<string, unknown>) =>
  expenseInputSchema.safeParse({ ...base, ...overrides });

describe("the category and subcategory pair", () => {
  it("accepts a subcategory of the category it belongs to", () => {
    expect(parse({ category: "transport", subcategory: "fuel" }).success).toBe(
      true,
    );
    expect(
      parse({ category: "home", subcategory: "electricity" }).success,
    ).toBe(true);
  });

  it("refuses a subcategory of a different category", () => {
    const result = parse({ category: "restaurants", subcategory: "fuel" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["subcategory"]);
  });

  it("accepts a category with no subcategory at all", () => {
    // Filing something as `home` and stopping there is a complete answer.
    expect(parse({ category: "home" }).success).toBe(true);
    expect(parse({ category: "home", subcategory: "" }).success).toBe(true);
    expect(parse({ category: "other" }).success).toBe(true);
  });

  it("refuses a subcategory hung on a retired code", () => {
    // `housing` is not a category any more, so nothing sits under it.
    expect(parse({ category: "housing", subcategory: "rent" }).success).toBe(
      false,
    );
  });

  it("refuses a subcategory hung on free text", () => {
    expect(
      parse({ category: "Chalet fund", subcategory: "rent" }).success,
    ).toBe(false);
  });

  it("still accepts an imported label as a bare category", () => {
    // Unrecognised is not the same as invalid: an import writes the source's
    // own label when nothing matched, and editing that expense must not be
    // the moment it becomes unsavable.
    expect(parse({ category: "Fournitures ménagères" }).success).toBe(true);
    expect(parse({ category: "housing" }).success).toBe(true);
  });

  it("treats an entry with no category as valid, as it always was", () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ category: "" }).success).toBe(true);
  });
});

/**
 * Two vocabularies share the `category` column, told apart by `direction`.
 * The form clears the category when the type changes, but a form is a
 * convenience — this is the boundary the API and the importers cross.
 */
describe("the category and the direction", () => {
  it("accepts an income category on an income", () => {
    expect(
      parse({ direction: "in", category: "rent", subcategory: "monthly_rent" })
        .success,
    ).toBe(true);
    expect(parse({ direction: "in", category: "deposits" }).success).toBe(true);
  });

  it("refuses an expense category on an income", () => {
    const result = parse({ direction: "in", category: "groceries" });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0].path).toEqual(["category"]);
  });

  it("refuses an income category on spending", () => {
    expect(parse({ direction: "out", category: "deposits" }).success).toBe(
      false,
    );
    // Absent means spending, the way it does on the entry itself.
    expect(parse({ category: "deposits" }).success).toBe(false);
  });

  it("reads a shared word as the vocabulary of its direction", () => {
    // `rent` is an income category and a `home` subcategory on expenses.
    expect(parse({ direction: "in", category: "rent" }).success).toBe(true);
    expect(parse({ direction: "out", category: "rent" }).success).toBe(false);
    expect(
      parse({ direction: "out", category: "home", subcategory: "rent" })
        .success,
    ).toBe(true);
    expect(
      parse({ direction: "in", category: "home", subcategory: "rent" }).success,
    ).toBe(false);
  });

  it("still accepts an imported label whichever way the money went", () => {
    // Free text is not a code of the other vocabulary; it is nobody's code.
    expect(
      parse({ direction: "in", category: "Fournitures ménagères" }).success,
    ).toBe(true);
  });
});
