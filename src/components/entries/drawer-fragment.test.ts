import { describe, expect, it } from "vitest";
import {
  fragmentParams,
  RESUME_PARAM,
  SHEET_PARAM,
  sheetOf,
  withFragment,
} from "./drawer-fragment";

/**
 * The drawer's parameters live after the `#`, and these are the two helpers
 * every link into the drawer goes through to put them there and take them out.
 */

describe("withFragment", () => {
  it("writes the parameters after a hash, never after a question mark", () => {
    expect(withFragment("/groups/g1/expenses/new", { draft: "1" })).toBe(
      "/groups/g1/expenses/new#draft=1",
    );
    expect(
      withFragment("/groups/g1/expenses/new", "cat=food&q=h%C3%B4tel"),
    ).toBe("/groups/g1/expenses/new#cat=food&q=h%C3%B4tel");
  });

  it("leaves a path alone when there is nothing to say", () => {
    expect(withFragment("/groups/g1/expenses/new", "")).toBe(
      "/groups/g1/expenses/new",
    );
    expect(withFragment("/groups/g1/expenses/new", {})).toBe(
      "/groups/g1/expenses/new",
    );
  });

  /**
   * An edit URL arrives carrying the list's filters, and the saved-entry toast
   * adds the sheet it links to on top of them. Two `#`s would be a broken URL,
   * and dropping the filters would lose the reader's way back to their list.
   */
  it("merges with a fragment the path already carries", () => {
    expect(
      withFragment("/groups/g1/expenses/e1/edit#cat=food&cat=drink", {
        [SHEET_PARAM]: "split",
      }),
    ).toBe("/groups/g1/expenses/e1/edit#cat=food&cat=drink&sheet=split");
  });

  it("replaces every value of a parameter it names again", () => {
    expect(
      withFragment("/x#cat=food&cat=drink&q=a", new URLSearchParams("cat=tea")),
    ).toBe("/x#q=a&cat=tea");
  });
});

describe("fragmentParams", () => {
  it("reads the fragment with or without its hash", () => {
    expect(fragmentParams("#draft=1").get(RESUME_PARAM)).toBe("1");
    expect(fragmentParams("draft=1").get(RESUME_PARAM)).toBe("1");
    expect([...fragmentParams("")]).toEqual([]);
  });

  it("round-trips what withFragment wrote", () => {
    const href = withFragment("/groups/g1/expenses/new", {
      settleFrom: "seb",
      settleTo: "amélie",
      settleIn: "EUR",
    });
    const params = fragmentParams(new URL(href, "https://x.test").hash);

    expect(params.get("settleTo")).toBe("amélie");
    expect(params.get("settleIn")).toBe("EUR");
  });
});

describe("sheetOf", () => {
  it("opens the split sheet, and nothing anybody else typed", () => {
    expect(sheetOf(fragmentParams("#sheet=split"))).toBe("split");
    expect(sheetOf(fragmentParams("#sheet=payer"))).toBeUndefined();
    expect(sheetOf(fragmentParams("#"))).toBeUndefined();
  });
});
