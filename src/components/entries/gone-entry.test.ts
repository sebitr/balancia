import { describe, expect, it } from "vitest";
import { transactionsPath } from "./gone-entry";

/**
 * The way out of a removed entry, worked out from its own address.
 *
 * A `not-found` boundary is handed no params, so the path is what there is.
 * Getting this wrong points the only button on the screen at a group that does
 * not exist, which is the one thing worse than the 404 it replaced.
 */
describe("the way back to the transactions", () => {
  it("takes the group out of an entry's address", () => {
    expect(transactionsPath("/groups/g1/expenses/e1")).toBe(
      "/groups/g1/expenses",
    );
    expect(transactionsPath("/groups/g1/settlements/s1")).toBe(
      "/groups/g1/expenses",
    );
  });

  it("survives the edit route the reader presses back onto", () => {
    expect(transactionsPath("/groups/g1/expenses/e1/edit")).toBe(
      "/groups/g1/expenses",
    );
  });

  it("offers nothing when the address is not inside a group", () => {
    expect(transactionsPath("/dashboard")).toBeNull();
    expect(transactionsPath("/groups")).toBeNull();
    expect(transactionsPath(null)).toBeNull();
  });
});
