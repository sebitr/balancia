import { describe, expect, it } from "vitest";
import { groupSplitDefault, worthSaving } from "./split-default";

/**
 * A saved split names people, and people leave groups. Almost every test here
 * is about the gap between when it was written and when it is read.
 */

const MEMBERS = ["seb", "herve", "cyril"];

describe("reading a saved split back", () => {
  it("keeps a shares split whose members are all still here", () => {
    expect(
      groupSplitDefault(
        {
          method: "shares",
          includedIds: ["seb", "herve", "cyril"],
          values: { seb: "3", herve: "3", cyril: "4" },
        },
        MEMBERS,
      ),
    ).toEqual({
      method: "shares",
      includedIds: ["seb", "herve", "cyril"],
      values: { seb: "3", herve: "3", cyril: "4" },
    });
  });

  it("drops somebody who has left", () => {
    const result = groupSplitDefault(
      {
        method: "equal",
        includedIds: ["seb", "herve", "gone"],
        values: {},
      },
      MEMBERS,
    );
    expect(result?.includedIds).toEqual(["seb", "herve"]);
  });

  it("refuses a weighted split that lost one of its weights", () => {
    // 30/30/40 missing a 30 is not a split, and there is no honest way to
    // hand somebody else the departed share.
    expect(
      groupSplitDefault(
        {
          method: "shares",
          includedIds: ["seb", "herve", "gone"],
          values: { seb: "3", herve: "3", gone: "4" },
        },
        MEMBERS,
      ),
    ).toBeNull();
  });

  it("refuses what is left of a split after everyone else went", () => {
    expect(
      groupSplitDefault(
        { method: "equal", includedIds: ["seb", "gone"], values: {} },
        MEMBERS,
      ),
    ).toBeNull();
  });

  it("refuses anything that is not a split", () => {
    expect(groupSplitDefault(null, MEMBERS)).toBeNull();
    expect(groupSplitDefault("equal", MEMBERS)).toBeNull();
    expect(groupSplitDefault({ method: "sideways" }, MEMBERS)).toBeNull();
    expect(
      groupSplitDefault({ method: "equal", includedIds: "everyone" }, MEMBERS),
    ).toBeNull();
  });

  it("ignores values belonging to nobody", () => {
    const result = groupSplitDefault(
      {
        method: "equal",
        includedIds: ["seb", "herve"],
        values: { seb: "1", ghost: "9" },
      },
      MEMBERS,
    );
    expect(result?.values).toEqual({ seb: "1" });
  });
});

describe("whether a split is worth offering to remember", () => {
  it("says no to equal between everyone, which is already the default", () => {
    expect(
      worthSaving({
        method: "equal",
        includedIds: MEMBERS,
        memberCount: MEMBERS.length,
      }),
    ).toBe(false);
  });

  it("says yes to equal between some of them", () => {
    expect(
      worthSaving({
        method: "equal",
        includedIds: ["seb", "herve"],
        memberCount: MEMBERS.length,
      }),
    ).toBe(true);
  });

  it("says yes to any weighted split, everyone included or not", () => {
    expect(
      worthSaving({
        method: "shares",
        includedIds: MEMBERS,
        memberCount: MEMBERS.length,
      }),
    ).toBe(true);
  });

  it("says no when nobody is selected", () => {
    expect(
      worthSaving({ method: "equal", includedIds: [], memberCount: 3 }),
    ).toBe(false);
  });
});
