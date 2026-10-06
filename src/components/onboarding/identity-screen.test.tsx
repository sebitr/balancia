import { useState } from "react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import en from "../../../messages/en.json";
import type { Intent } from "./route";

/**
 * Where the caret is after the address or the code is refused.
 *
 * The address field and the code boxes are both disabled while their request
 * is out, and a focused control that becomes disabled lets go of focus — so a
 * refusal left the keyboard on the page body, and the message under the field,
 * which is not an alert on this screen, went unread. The caret goes back into
 * the field the refusal is about, and that field is described by it.
 */

const auth = vi.hoisted(() => ({
  requestSignInCodeAction: vi.fn(),
  signInWithCodeAction: vi.fn(),
  startCodeSignupAction: vi.fn(),
  verifySignupCodeAction: vi.fn(),
}));

vi.mock("@/modules/auth/actions", () => auth);

// No WebAuthn in jsdom, and the passkey half of this screen is not what is
// under test: the code is the only way offered.
vi.mock("@/components/auth/use-passkey-support", () => ({
  usePasskeySupport: () => false,
  usePlatformAuthenticator: () => false,
}));
vi.mock("@/modules/auth/passkey-client", () => ({
  signInWithPasskey: vi.fn(),
}));
vi.mock("@simplewebauthn/browser", () => ({ startRegistration: vi.fn() }));
vi.mock("@/components/auth/use-proof-of-work", () => ({
  useProofOfWork: () => ({ solution: async () => null }),
}));

const { IdentityScreen } = await import("./identity-screen");

const onDone = vi.fn();

/** The screen with the address held the way the flow around it holds it. */
function Harness({ intent }: { intent: Intent }) {
  const [email, setEmail] = useState("");
  return (
    <IdentityScreen
      intent={intent}
      name="Ada Lovelace"
      email={email}
      onEmailChange={setEmail}
      codeSignupAvailable
      onDone={onDone}
    />
  );
}

/** Holds the server's next answer back until the test hands it over. */
function answerLater(action: Mock): (result: unknown) => void {
  let answer: (result: unknown) => void = () => {};
  action.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        answer = resolve;
      }),
  );
  return (result) => answer(result);
}

beforeEach(() => {
  for (const action of Object.values(auth)) action.mockReset();
  auth.startCodeSignupAction.mockResolvedValue({ ok: true });
  auth.requestSignInCodeAction.mockResolvedValue({ ok: true });
  onDone.mockReset();
});

describe("after a refusal", () => {
  it("puts the caret back in the address when no code could be sent to it", async () => {
    auth.startCodeSignupAction.mockResolvedValue({
      ok: false,
      error: en.serverErrors.emailTaken,
    });
    const user = userEvent.setup();
    renderWithIntl(<Harness intent="account" />);

    const email = screen.getByLabelText(en.onboarding.identity.emailLabel);
    await user.type(email, "ada@example.com");
    await user.click(
      screen.getByRole("button", { name: en.onboarding.identity.emailMeACode }),
    );

    await waitFor(() => expect(email).toHaveFocus());
    expect(email).toHaveValue("ada@example.com");
    // Not an alert on this screen, so the field is what reads it out.
    expect(email).toHaveAccessibleDescription(en.serverErrors.emailTaken);
  });

  it("puts the caret back in the emptied boxes after a wrong code", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness intent="signin" />);

    await user.type(
      screen.getByLabelText(en.onboarding.identity.emailLabel),
      "ada@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: en.onboarding.identity.emailMeACode }),
    );

    const answer = answerLater(auth.signInWithCodeAction);
    const boxes = screen.getByLabelText(en.onboarding.identity.codeLabel);
    await user.type(boxes, "123456");
    await waitFor(() => expect(auth.signInWithCodeAction).toHaveBeenCalled());

    // A browser lets go of the boxes' focus as they are disabled for the
    // check; jsdom keeps it, so it is put somewhere else by hand.
    const elsewhere = document.body.appendChild(
      document.createElement("button"),
    );
    elsewhere.focus();
    answer({ ok: false, error: en.onboarding.identity.codeWrong });

    await waitFor(() => expect(boxes).toHaveFocus());
    elsewhere.remove();
    expect(boxes).toHaveValue("");
    expect(boxes).toHaveAccessibleDescription(en.onboarding.identity.codeWrong);
    // The address keeps its own description clear: it was not what was wrong.
    expect(
      screen.getByLabelText(en.onboarding.identity.emailLabel),
    ).not.toHaveAttribute("aria-describedby");
    expect(onDone).not.toHaveBeenCalled();
  });
});
