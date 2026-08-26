import { describe, expect, it } from "vitest";
import { matchesDemoCredential } from "./credentials";

describe("the demo credential", () => {
  it("accepts what the sign-in page tells a visitor to type", () => {
    expect(matchesDemoCredential({ email: "demo", password: "demo" })).toBe(
      true,
    );
  });

  it("forgives what a phone keyboard does to it", () => {
    // Autocapitalisation and a trailing space from a paste are not a reason to
    // refuse somebody who typed exactly what was on the screen.
    expect(matchesDemoCredential({ email: "Demo", password: "demo" })).toBe(
      true,
    );
    expect(matchesDemoCredential({ email: " demo ", password: "demo" })).toBe(
      true,
    );
  });

  it("does not stretch to the password", () => {
    expect(matchesDemoCredential({ email: "demo", password: "Demo" })).toBe(
      false,
    );
    expect(matchesDemoCredential({ email: "demo", password: "demo " })).toBe(
      false,
    );
  });

  it("does not fire on a real account that happens to start with it", () => {
    expect(
      matchesDemoCredential({ email: "demo@example.com", password: "demo" }),
    ).toBe(false);
    expect(matchesDemoCredential({ email: "demo", password: "hunter2" })).toBe(
      false,
    );
  });

  it("survives whatever a hand-rolled request submits", () => {
    expect(matchesDemoCredential(null)).toBe(false);
    expect(matchesDemoCredential("demo")).toBe(false);
    expect(matchesDemoCredential({ email: 1, password: 1 })).toBe(false);
    expect(matchesDemoCredential({})).toBe(false);
  });
});
