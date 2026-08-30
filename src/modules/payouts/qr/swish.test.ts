import { describe, expect, it } from "vitest";
import { buildSwishQrPayload, type SwishQrInput } from "./swish";

/**
 * The Swish person-to-person code: four fields, three semicolons, no API.
 *
 * The assertions are on positions rather than on a whole string wherever a
 * field could go missing, because the failure that matters here is silent —
 * an empty message dropping its separator turns the editable mask into the
 * message and leaves a reader with three fields where it wanted four.
 */

const input: SwishQrInput = {
  phone: "+46701234567",
  minorUnits: "8420",
  currency: "SEK",
  message: "Weekend in Verbier",
};

const build = (overrides: Partial<SwishQrInput> = {}) =>
  buildSwishQrPayload({ ...input, ...overrides });

describe("the payload", () => {
  it("writes the four fields in order, starting with C", () => {
    expect(build()).toBe("C46701234567;84.20;Weekend in Verbier;0");
  });

  it("keeps the separators when the message is empty", () => {
    // Three semicolons whatever happens. A reader that gets two takes the
    // editable mask for the message.
    const payload = build({ message: "  " });
    expect(payload).toBe("C46701234567;84.20;;0");
    expect(payload!.split(";")).toHaveLength(4);
  });

  it("locks every field", () => {
    // The amount on the code is the amount the balances say is owed. A payer
    // who edits it has not settled the debt the row is about.
    expect(build()!.split(";")[3]).toBe("0");
  });

  it("drops the plus but keeps the country code", () => {
    expect(build({ phone: "+46 70 123 45 67" })!.split(";")[0]).toBe(
      "C46701234567",
    );
  });
});

describe("the message", () => {
  it("takes out the character that would add a field", () => {
    // A group really can be called "Rome; 2026", and that is not a reason to
    // refuse a code.
    expect(build({ message: "Rome; 2026" })!.split(";")).toHaveLength(4);
    expect(build({ message: "Rome; 2026" })!.split(";")[2]).toBe("Rome 2026");
  });

  it("cuts to what Swish carries", () => {
    expect(build({ message: "x".repeat(80) })!.split(";")[2]).toHaveLength(50);
  });
});

describe("refusing", () => {
  it("builds nothing for a debt that is not in kronor", () => {
    // The format has no currency field at all — the number is kronor by
    // definition — so a euro debt cannot be expressed, only misrepresented.
    expect(build({ currency: "EUR" })).toBeNull();
  });

  it("refuses a number that is not Swedish", () => {
    expect(build({ phone: "+41791234567" })).toBeNull();
    expect(build({ phone: "0701234567" })).toBeNull();
    expect(build({ phone: "not a number" })).toBeNull();
  });

  it("refuses a debt of nothing, or of less than nothing", () => {
    expect(build({ minorUnits: "0" })).toBeNull();
    expect(build({ minorUnits: "-500" })).toBeNull();
  });
});
