import { describe, expect, it } from "vitest";
import {
  descriptionSimilarity,
  findDuplicate,
  type RecentEntry,
} from "./duplicate-note";

/**
 * The rule behind "Similar entry 2h ago".
 *
 * A false positive here is expensive — it makes a correct entry look wrong —
 * so most of these tests are about what does *not* match.
 */

const entry = (overrides: Partial<RecentEntry> = {}): RecentEntry => ({
  id: "e1",
  description: "Coop Genève",
  amountMinor: "6120",
  currency: "CHF",
  amountFormatted: "61.20",
  payerName: "Seb",
  category: "groceries",
  hoursAgo: 2,
  ...overrides,
});

const find = (overrides: Partial<Parameters<typeof findDuplicate>[0]> = {}) =>
  findDuplicate({
    amountMinor: 6120n,
    currency: "CHF",
    description: "Coop Genève",
    category: "groceries",
    recent: [entry()],
    ...overrides,
  });

describe("finding the entry this might repeat", () => {
  it("matches the same shop for the same money", () => {
    expect(find()?.id).toBe("e1");
  });

  it("allows the amounts to differ by a little", () => {
    // Within 2%: 61.20 against 62.00.
    expect(find({ amountMinor: 6200n })?.id).toBe("e1");
    // Beyond it.
    expect(find({ amountMinor: 6500n })).toBeNull();
  });

  it("wants the same currency", () => {
    expect(find({ currency: "EUR" })).toBeNull();
  });

  it("looks back two days and no further", () => {
    expect(find({ recent: [entry({ hoursAgo: 47 })] })?.id).toBe("e1");
    expect(find({ recent: [entry({ hoursAgo: 49 })] })).toBeNull();
  });

  it("needs more than a matching amount", () => {
    // Same money, nothing else in common: two CHF 61.20 entries on one day
    // are not evidence of anything.
    expect(
      find({
        description: "Dentist",
        category: "health",
        recent: [entry()],
      }),
    ).toBeNull();
  });

  it("takes the category as corroboration when the words differ", () => {
    expect(
      find({
        description: "Groceries",
        category: "groceries",
        recent: [entry()],
      })?.id,
    ).toBe("e1");
  });

  it("takes the words as corroboration when the category is missing", () => {
    expect(
      find({
        category: "",
        recent: [entry({ category: "" })],
      })?.id,
    ).toBe("e1");
  });

  it("shows the most recent match and only it", () => {
    const match = find({
      recent: [
        entry({ id: "old", hoursAgo: 20 }),
        entry({ id: "new", hoursAgo: 3 }),
      ],
    });
    expect(match?.id).toBe("new");
  });

  it("says nothing until there is an amount", () => {
    expect(find({ amountMinor: 0n })).toBeNull();
    expect(find({ amountMinor: -100n })).toBeNull();
  });

  it("ignores an entry with no amount of its own", () => {
    expect(find({ recent: [entry({ amountMinor: "0" })] })).toBeNull();
  });
});

describe("how alike two descriptions are", () => {
  it("reads a shortened name as the same one", () => {
    expect(descriptionSimilarity("Coop Genève", "Coop")).toBe(1);
  });

  it("folds case and accents", () => {
    expect(descriptionSimilarity("COOP GENEVE", "coop genève")).toBe(1);
  });

  it("scores unrelated text at zero", () => {
    expect(descriptionSimilarity("Coop", "Dentist")).toBe(0);
  });

  it("treats an empty description as no evidence", () => {
    expect(descriptionSimilarity("", "Coop")).toBe(0);
    // A single letter is not a word worth matching on.
    expect(descriptionSimilarity("a", "a b")).toBe(0);
  });
});
