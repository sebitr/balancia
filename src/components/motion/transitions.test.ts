import { describe, expect, it } from "vitest";
import { screenPath } from "./transitions";

/**
 * Which paths are a screen, and which are a layer over one.
 *
 * `<Screen>` is keyed on this. Get it wrong in one direction and the group
 * behind the add-entry drawer runs the push animation and remounts scrolled to
 * the top while the sheet rises over it; get it wrong in the other and two
 * genuinely different screens share a key and neither ever animates.
 */
describe("screenPath", () => {
  it("takes the add-entry drawer to be the group underneath it", () => {
    expect(screenPath("/groups/g1/expenses/new")).toBe("/groups/g1");
  });

  it("leaves every other path exactly as it is", () => {
    for (const path of [
      "/groups/g1",
      "/groups/g1/expenses",
      "/groups/g1/balances",
      "/groups/g1/members",
      "/groups/g1/recurring",
      "/dashboard",
      "/",
    ]) {
      expect(screenPath(path)).toBe(path);
    }
  });

  /** An expense's own page is a screen, however much its URL rhymes. */
  it("does not mistake a neighbouring expense route for the drawer", () => {
    expect(screenPath("/groups/g1/expenses/e1")).toBe("/groups/g1/expenses/e1");
    expect(screenPath("/groups/g1/expenses/e1/edit")).toBe(
      "/groups/g1/expenses/e1/edit",
    );
    expect(screenPath("/groups/g1/expenses/new/extra")).toBe(
      "/groups/g1/expenses/new/extra",
    );
  });
});
