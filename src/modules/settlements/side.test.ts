import { describe, expect, it } from "vitest";
import { repaymentSide } from "./side";

describe("repaymentSide", () => {
  const pair = { fromParticipantId: "sam", toParticipantId: "robin" };

  it("is paid when the reader sent the money", () => {
    expect(repaymentSide(pair, "sam")).toBe("paid");
  });

  it("is received when the money came to the reader", () => {
    expect(repaymentSide(pair, "robin")).toBe("received");
  });

  it("is between when the reader is neither", () => {
    expect(repaymentSide(pair, "grace")).toBe("between");
  });

  it("is between when there is no reader to call you", () => {
    expect(repaymentSide(pair, null)).toBe("between");
    expect(repaymentSide(pair, undefined)).toBe("between");
    expect(repaymentSide(pair, "")).toBe("between");
  });
});
