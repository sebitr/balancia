import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import en from "../../../messages/en.json";
import { ResetPasswordForm } from "./reset-password-form";

/**
 * A refusal on the new-password form is tied to the field it is about, as it
 * is on the registration form: the error is part of the field's description,
 * after the rule, and the field says it is invalid — so a screen reader that
 * comes back to the field hears what is wrong with it, not only the rule.
 */

const resetPasswordAction = vi.fn();

vi.mock("@/modules/auth/actions", () => ({
  resetPasswordAction: (...args: unknown[]) => resetPasswordAction(...args),
}));

async function submit(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
  confirmation: string,
) {
  await user.type(screen.getByLabelText("New password"), password);
  await user.type(screen.getByLabelText("Confirm password"), confirmation);
  await user.click(
    screen.getByRole("button", { name: en.resetPassword.submit }),
  );
}

describe("the new-password errors", () => {
  it("describe the password with its rule and what broke it", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ResetPasswordForm token="token" />);

    await submit(user, "short", "short");

    const password = screen.getByLabelText("New password");
    expect(password).toHaveAttribute("aria-invalid", "true");
    expect(password).toHaveAccessibleDescription(
      `${en.resetPassword.passwordHint} ${en.register.validation.passwordMin}`,
    );
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it("describe the confirmation when the two do not match", async () => {
    const user = userEvent.setup();
    renderWithIntl(<ResetPasswordForm token="token" />);

    await submit(user, "orchid-lantern-42", "orchid-lantern-43");

    const confirm = screen.getByLabelText("Confirm password");
    expect(confirm).toHaveAttribute("aria-invalid", "true");
    expect(confirm).toHaveAccessibleDescription(
      en.register.validation.mismatch,
    );
    expect(resetPasswordAction).not.toHaveBeenCalled();
  });

  it("describe the password by its rule alone until there is an error", () => {
    renderWithIntl(<ResetPasswordForm token="token" />);

    expect(screen.getByLabelText("New password")).toHaveAccessibleDescription(
      en.resetPassword.passwordHint,
    );
    expect(screen.getByLabelText("Confirm password")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});

/**
 * Where the caret is after the server says no.
 *
 * The server holds a new password to two rules this form cannot check — not
 * a common one, not the account's own name or address — so a refusal is
 * usually about the new password, and the caret goes back into it with the
 * attempt selected. The button that was pressed is disabled while the request
 * is out, and used to leave the keyboard on the page body.
 */
describe("after the server refuses", () => {
  it("puts the caret back in the new password, selected", async () => {
    resetPasswordAction.mockResolvedValueOnce({
      ok: false,
      error: en.serverErrors.passwordCommon,
    });
    const user = userEvent.setup();
    renderWithIntl(<ResetPasswordForm token="token" />);

    await submit(user, "orchid-lantern-42", "orchid-lantern-42");

    const password = screen.getByLabelText<HTMLInputElement>("New password");
    await waitFor(() => expect(password).toHaveFocus());
    expect(password.selectionStart).toBe(0);
    expect(password.selectionEnd).toBe("orchid-lantern-42".length);
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.serverErrors.passwordCommon,
    );
    // The rule, and then why this attempt at it was refused.
    expect(password).toHaveAccessibleDescription(
      `${en.resetPassword.passwordHint} ${en.serverErrors.passwordCommon}`,
    );
  });
});
