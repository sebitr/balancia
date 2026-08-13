import { describe, expect, it, vi } from "vitest";
import { runAction } from "./actions";
import { AllocationError } from "@/modules/expenses/allocation";
import { AuthError } from "@/modules/auth/service";
import { AuthorizationError } from "@/lib/security/authorization";
import { InvalidAmountError } from "@/modules/currencies/money";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * `runAction` decides what a user is told when something fails.
 *
 * The distinction it draws is the whole point: domain errors carry sentences
 * written for a person and must reach them intact, while anything unexpected
 * must be flattened so a stack trace or a query never escapes to the browser.
 */

describe("runAction", () => {
  it("returns the value on success", async () => {
    await expect(runAction("test", async () => 42)).resolves.toEqual({
      ok: true,
      data: 42,
    });
  });

  it.each([
    ["AllocationError", new AllocationError("Shares must sum to the total")],
    ["AuthorizationError", new AuthorizationError("Not your group.")],
    ["InvalidAmountError", new InvalidAmountError("That is not an amount")],
  ])("surfaces a %s message verbatim", async (_name, error) => {
    const result = await runAction("test", async () => {
      throw error;
    });
    expect(result).toEqual({ ok: false, error: error.message });
  });

  /*
   * Regression: AuthError was missing from the safe list, so every wrong
   * password, every unverified email and every duplicate registration reached
   * the user as "Something went wrong on the server" — and was logged at ERROR
   * level as though the server had actually broken.
   */
  it.each([
    "That email and password combination did not work.",
    "Confirm your email address before signing in. Check your inbox for the link.",
    "That email address is already registered. Try signing in instead.",
    "Your current password is not correct.",
  ])("surfaces the auth message %j", async (message) => {
    const result = await runAction("auth.signIn", async () => {
      throw new AuthError(message);
    });
    expect(result).toEqual({ ok: false, error: message });
  });

  it("flattens an unexpected error rather than leaking it", async () => {
    const result = await runAction("test", async () => {
      throw new Error("relation \"users\" does not exist at line 3");
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Something went wrong on the server. Nothing was changed.",
    );
    expect(result.error).not.toContain("users");
  });
});
