import { describe, expect, it, vi } from "vitest";
import messages from "../../messages/en.json";
import { runAction } from "./actions";
import { AllocationError } from "@/modules/expenses/allocation";
import { AuthError } from "@/modules/auth/service";
import { AuthorizationError } from "@/lib/security/authorization";
import { InvalidAmountError } from "@/modules/currencies/money";

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

/**
 * `getTranslations` needs a request context that a node unit test has no way
 * to provide, so it is resolved against the shipped English catalogue here.
 * The assertions below therefore still check the copy a user actually gets — a
 * key removed from `messages/en.json` breaks this file rather than passing.
 */
vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: keyof typeof messages) => {
    const entries = messages[namespace] as Record<string, string>;
    const translate = (key: string, params?: Record<string, string | number>) =>
      Object.entries(params ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{${name}}`, String(value)),
        entries[key] ?? key,
      );
    return Object.assign(translate, {
      has: (key: string) => key in entries,
    });
  },
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
    ["InvalidAmountError", new InvalidAmountError("That is not an amount")],
  ])("surfaces a %s message verbatim", async (_name, error) => {
    const result = await runAction("test", async () => {
      throw error;
    });
    expect(result).toEqual({ ok: false, error: error.message });
  });

  /*
   * An error carrying a stable reason code is answered from the catalogue in
   * the reader's language, so the sentence it was constructed with is not what
   * reaches them. Errors without a code keep falling back to their message,
   * which is what the case above pins down.
   */
  it("translates a coded error rather than passing its message through", async () => {
    const result = await runAction("test", async () => {
      throw new AuthorizationError("Not your group.");
    });

    expect(result).toEqual({
      ok: false,
      error: messages.serverErrors.noGroupAccess,
    });
  });

  /*
   * Regression: AuthError was missing from the safe list, so every wrong
   * password, every unverified email and every duplicate registration reached
   * the user as "Something went wrong on the server" — and was logged at ERROR
   * level as though the server had actually broken.
   */
  it.each([
    "Incorrect email or password.",
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
      throw new Error('relation "users" does not exist at line 3');
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe(
      "Something went wrong on the server. Nothing was changed.",
    );
    expect(result.error).not.toContain("users");
  });
});
