import { describe, expect, it } from "vitest";
import { provisionalNameFor } from "./provisional-name";

describe("provisionalNameFor", () => {
  it("stands the address's local part in", () => {
    expect(provisionalNameFor("cold-mtke@test.local")).toBe("cold-mtke");
    expect(provisionalNameFor("ada.lovelace@example.com")).toBe("ada.lovelace");
  });

  it("falls back to the whole address when there is no local part", () => {
    // Nothing that reaches a signup looks like this — the address is validated
    // long before — but a name screen with an empty heading is worse than one
    // showing a string nobody typed, so there is no path here that returns "".
    expect(provisionalNameFor("@example.com")).toBe("@example.com");
    expect(provisionalNameFor("  @x")).toBe("  @x");
  });
});
