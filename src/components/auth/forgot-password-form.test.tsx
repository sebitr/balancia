import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import en from "../../../messages/en.json";
import { ForgotPasswordForm } from "./forgot-password-form";

/**
 * Where the caret is after the server says no.
 *
 * The address is the form's only field, and the button that sends it is
 * disabled while the request is out — which lets go of focus, so a refusal
 * used to leave a keyboard on the page body. It goes back into the address,
 * and the address is described by why it was refused.
 */

const requestPasswordResetAction = vi.fn();

vi.mock("@/modules/auth/actions", () => ({
  requestPasswordResetAction: (...args: unknown[]) =>
    requestPasswordResetAction(...args),
}));

describe("after the server refuses", () => {
  it("puts the caret back in the address, with the address kept", async () => {
    requestPasswordResetAction.mockResolvedValueOnce({
      ok: false,
      error: en.serverErrors.rateLimited,
    });
    const user = userEvent.setup();
    renderWithIntl(<ForgotPasswordForm />);

    const email = screen.getByLabelText(en.forgotPassword.email);
    await user.type(email, "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: en.forgotPassword.submit }),
    );

    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.serverErrors.rateLimited,
    );
    expect(email).toHaveAccessibleDescription(en.serverErrors.rateLimited);
    expect(email).toHaveValue("ada@example.com");
  });

  it("describes the address with nothing before anything is refused", () => {
    renderWithIntl(<ForgotPasswordForm />);

    expect(screen.getByLabelText(en.forgotPassword.email)).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
