/**
 * @vitest-environment jsdom
 *
 * A `.ts` test runs under Node, where there is no `sessionStorage` to keep a
 * place in. This one asks for a browser.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { forgetPlace, readPlace, rememberPlace } from "./list-place";

/**
 * The record survives one trip out of the list and back, and nothing else: not
 * another group, not a second reading, and not whatever else may be sitting
 * under the key.
 */
const PLACE = { rows: 120, scrollY: 2400, search: "cat=lodging" };

describe("the remembered place", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("comes back as it went in", () => {
    rememberPlace("g1", PLACE);

    expect(readPlace("g1")).toEqual(PLACE);
  });

  it("reads the same thing twice, so a render can ask without changing it", () => {
    rememberPlace("g1", PLACE);

    expect(readPlace("g1")).toEqual(PLACE);
    expect(readPlace("g1")).toEqual(PLACE);
  });

  it("belongs to the group it was written in", () => {
    rememberPlace("g1", PLACE);

    // Another group's list is another list, however far down this reader was.
    expect(readPlace("g2")).toBeNull();
  });

  it("is gone once forgotten", () => {
    rememberPlace("g1", PLACE);
    forgetPlace();

    expect(readPlace("g1")).toBeNull();
  });

  it("holds one place, the latest", () => {
    rememberPlace("g1", PLACE);
    rememberPlace("g1", { rows: 40, scrollY: 0, search: "" });

    expect(readPlace("g1")).toEqual({ rows: 40, scrollY: 0, search: "" });
  });

  it("ignores anything it did not write", () => {
    sessionStorage.setItem("balancia:transactions-place", "not json at all");
    expect(readPlace("g1")).toBeNull();

    // The shape an older version of this file might have left behind.
    sessionStorage.setItem(
      "balancia:transactions-place",
      JSON.stringify({ groupId: "g1", offset: 2400 }),
    );
    expect(readPlace("g1")).toBeNull();
  });

  it("goes quiet when the store itself refuses", () => {
    // Safari in private browsing, or a full quota. Losing the place is a worse
    // trip back, not a broken screen.
    const setItem = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const getItem = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("SecurityError");
      });

    expect(() => rememberPlace("g1", PLACE)).not.toThrow();
    expect(readPlace("g1")).toBeNull();
    expect(() => forgetPlace()).not.toThrow();

    setItem.mockRestore();
    getItem.mockRestore();
  });
});
