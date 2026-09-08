import { describe, expect, it } from "vitest";
import { reminderInputSchema } from "./schemas";
import { REMIND_MESSAGE_MAX_LENGTH } from "./types";

const valid = {
  toParticipantId: "8ba9d6e2-0f1e-4c9a-8f1a-2c3d4e5f6a7b",
  message: "Whenever suits — €148.00 for the flat.",
  logToActivity: true,
};

describe("reminderInputSchema", () => {
  it("accepts what the sheet sends", () => {
    expect(reminderInputSchema.parse(valid)).toEqual(valid);
  });

  it("trims the message and refuses one that is only whitespace", () => {
    expect(
      reminderInputSchema.parse({ ...valid, message: "  hi  " }).message,
    ).toBe("hi");
    expect(
      reminderInputSchema.safeParse({ ...valid, message: "   \n  " }).success,
    ).toBe(false);
  });

  /*
   * The reason the schema exists. This field is stored per recipient in the
   * notifications payload, and the action used to declare its type and parse
   * nothing — so the ceiling was the 1 MB Server Action body limit.
   */
  it("refuses a message past the ceiling", () => {
    const atLimit = "x".repeat(REMIND_MESSAGE_MAX_LENGTH);
    expect(
      reminderInputSchema.safeParse({ ...valid, message: atLimit }).success,
    ).toBe(true);

    const overLimit = "x".repeat(REMIND_MESSAGE_MAX_LENGTH + 1);
    expect(
      reminderInputSchema.safeParse({ ...valid, message: overLimit }).success,
    ).toBe(false);
  });

  it.each([
    ["a participant id that is not a uuid", { toParticipantId: "../../etc" }],
    ["a missing message", { message: undefined }],
    ["a message that is not a string", { message: { toString: "no" } }],
    ["a non-boolean flag", { logToActivity: "yes" }],
  ])("refuses %s", (_label, patch) => {
    expect(reminderInputSchema.safeParse({ ...valid, ...patch }).success).toBe(
      false,
    );
  });

  it("refuses a payload that is not an object at all", () => {
    expect(reminderInputSchema.safeParse(null).success).toBe(false);
    expect(reminderInputSchema.safeParse("message").success).toBe(false);
  });
});
