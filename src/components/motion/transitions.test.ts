import { describe, expect, it } from "vitest";
import { screenPath } from "./transitions";

/**
 * Which paths are a screen, and which are a layer over one.
 *
 * `<Screen>` is keyed on this. Get it wrong in one direction and the screen
 * behind the add-entry drawer runs an animation and remounts scrolled to the
 * top while the sheet rises over it; get it wrong in the other and two
 * genuinely different screens share a key and neither ever animates.
 */
describe("screenPath", () => {
  const DRAWER = "/groups/g1/expenses/new";

  it("keeps the screen the drawer was opened from, whichever it was", () => {
    for (const from of [
      "/groups/g1",
      "/groups/g1/expenses",
      "/groups/g1/settle",
      "/groups/g1/members",
      "/groups/g1/expenses/e1",
    ]) {
      expect(screenPath(DRAWER, from)).toBe(from);
    }
  });

  /**
   * `(.)` only intercepts within the group. Reached from outside it, the same
   * URL is the standalone page — a screen, which should arrive like one.
   */
  it("treats the same URL as a screen when it was reached from outside", () => {
    expect(screenPath(DRAWER, "/dashboard")).toBe(DRAWER);
    expect(screenPath(DRAWER, "/groups/g2/expenses")).toBe(DRAWER);
    expect(screenPath(DRAWER, "/")).toBe(DRAWER);
  });

  /** A cold load has nothing behind it, so the drawer is all there is. */
  it("has no screen to hold when there is no previous one", () => {
    expect(screenPath(DRAWER, null)).toBe(DRAWER);
  });

  /** `/groups/g1` must not swallow `/groups/g10`. */
  it("does not mistake a group whose id merely starts the same", () => {
    expect(screenPath(DRAWER, "/groups/g10/expenses")).toBe(DRAWER);
    expect(screenPath("/groups/g10/expenses/new", "/groups/g1")).toBe(
      "/groups/g10/expenses/new",
    );
  });

  it("leaves every path that is not the drawer exactly as it is", () => {
    for (const path of [
      "/groups/g1",
      "/groups/g1/expenses",
      "/groups/g1/settle",
      "/dashboard",
      "/",
    ]) {
      expect(screenPath(path, "/groups/g1/expenses")).toBe(path);
      expect(screenPath(path, null)).toBe(path);
    }
  });

  /** An expense's own page is a screen, however much its URL rhymes. */
  it("does not mistake a neighbouring expense route for the drawer", () => {
    for (const path of [
      "/groups/g1/expenses/e1",
      "/groups/g1/expenses/new/extra",
      "/groups/g1/settlements/s1",
    ]) {
      expect(screenPath(path, "/groups/g1/expenses")).toBe(path);
    }
  });

  /** Reopening an entry is the same drawer, so it is the same layer. */
  it("holds the screen still under the edit drawer", () => {
    for (const path of [
      "/groups/g1/expenses/e1/edit",
      "/groups/g1/settlements/s1/edit",
    ]) {
      expect(screenPath(path, "/groups/g1/expenses")).toBe(
        "/groups/g1/expenses",
      );
      // Reached from outside the group, it is a screen of its own again.
      expect(screenPath(path, "/dashboard")).toBe(path);
    }
  });
});
