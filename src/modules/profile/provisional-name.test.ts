import { describe, expect, it } from "vitest";
import { isProvisionalName } from "./provisional-name";

describe("isProvisionalName", () => {
  it("recognises the local part the code signup stood in with", () => {
    expect(isProvisionalName("cold-mtke", "cold-mtke@test.local")).toBe(true);
    expect(isProvisionalName("Ada.Lovelace", "ada.lovelace@example.com")).toBe(
      true,
    );
  });

  it("leaves a name somebody actually typed alone", () => {
    expect(isProvisionalName("Ada Lovelace", "ada@example.com")).toBe(false);
    expect(isProvisionalName("Ada", "ada.lovelace@example.com")).toBe(false);
  });

  it("never fires on an empty address", () => {
    expect(isProvisionalName("", "")).toBe(false);
    expect(isProvisionalName("x", "@example.com")).toBe(false);
  });
});
