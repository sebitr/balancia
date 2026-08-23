import { describe, expect, it } from "vitest";
import { listQuery, withQuery } from "./list-query";

/**
 * The filters have to survive being written by the island, read by a Server
 * Component, and written back onto a link — so both shapes they arrive in are
 * driven here, and the string that comes out is compared to itself.
 */
describe("listQuery", () => {
  it("reads the filters a Server Component is handed", () => {
    expect(
      listQuery({
        cat: ["lodging", "restaurants"],
        kind: "expense",
        q: "hôtel",
      }),
    ).toBe("cat=lodging&cat=restaurants&kind=expense&q=h%C3%B4tel");
  });

  it("reads the same filters off the URL the island wrote", () => {
    const url = new URLSearchParams(
      "?q=h%C3%B4tel&cat=lodging&cat=restaurants&kind=expense",
    );

    // The same three filters in another order are the same list, and must
    // print the same: a remembered position is matched by this string.
    expect(listQuery(url)).toBe(
      "cat=lodging&cat=restaurants&kind=expense&q=h%C3%B4tel",
    );
  });

  it("carries nothing else, whatever else is on the URL", () => {
    expect(listQuery(new URLSearchParams("?cat=home&ref=email&utm=x"))).toBe(
      "cat=home",
    );
  });

  it("treats an empty search field as no filter at all", () => {
    expect(listQuery(new URLSearchParams("?q="))).toBe("");
    expect(listQuery({ q: "" })).toBe("");
  });

  it("says nothing when nothing is on", () => {
    expect(listQuery(new URLSearchParams())).toBe("");
    expect(listQuery({})).toBe("");
  });
});

describe("withQuery", () => {
  it("leaves a bare path bare rather than trailing a question mark", () => {
    expect(withQuery("/groups/g1/expenses", "")).toBe("/groups/g1/expenses");
  });

  it("hangs the filters off the path when there are some", () => {
    expect(withQuery("/groups/g1/expenses", "cat=home")).toBe(
      "/groups/g1/expenses?cat=home",
    );
  });
});
