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
 * which was not an alert on this screen, went unread. The caret goes back into
 * the field the refusal is about, that field is described by it, and the
 * message is an alert too, as the sign-in form's is.
 */

const auth = vi.hoisted(() => ({
  registerAction: vi.fn(),
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
function Harness({
  intent,
  knownName = "Ada Lovelace",
  codeSignupAvailable = true,
}: {
  intent: Intent;
  knownName?: string;
  codeSignupAvailable?: boolean;
}) {
  const [name, setName] = useState(knownName);
  const [email, setEmail] = useState("");
  return (
    <IdentityScreen
      intent={intent}
      name={name}
      onNameChange={setName}
      email={email}
      onEmailChange={setEmail}
      codeSignupAvailable={codeSignupAvailable}
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
    // Announced as it appears, and read again with the field it is about.
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.serverErrors.emailTaken,
    );
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
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.onboarding.identity.codeWrong,
    );
    expect(boxes).toHaveAccessibleDescription(en.onboarding.identity.codeWrong);
    // The address keeps its own description clear: it was not what was wrong.
    expect(
      screen.getByLabelText(en.onboarding.identity.emailLabel),
    ).not.toHaveAttribute("aria-describedby");
    expect(onDone).not.toHaveBeenCalled();
  });
});

/**
 * No mail server and no WebAuthn: the one combination where a password is the
 * only way in, and so the whole of the step rather than a tap under it.
 */
describe("with neither a code nor a passkey to offer", () => {
  const strings = en.onboarding.identity;

  it("asks for the password on this step, and says why", () => {
    renderWithIntl(
      <Harness intent="account" codeSignupAvailable={false} knownName="" />,
    );

    expect(
      screen.getByRole("heading", { name: strings.passwordTitle }),
    ).toBeInTheDocument();
    expect(screen.getByText(strings.noCredentialRoute)).toBeInTheDocument();
    // Nothing to go back to: there is no passkey on this browser.
    expect(
      screen.queryByRole("button", { name: strings.usePasskeyInstead }),
    ).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    // Nobody has named this account yet, so the step does.
    expect(
      screen.getByRole("textbox", { name: strings.nameLabel }),
    ).toHaveFocus();
  });

  it("shows the password it hides, from the eye, without leaving the field", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness intent="account" codeSignupAvailable={false} />);

    const password = screen.getByLabelText(strings.passwordLabel);
    await user.type(password, "analytical engine");
    expect(password).toHaveAttribute("type", "password");

    const eye = screen.getByRole("button", { name: en.common.showPassword });
    await user.click(eye);
    expect(password).toHaveAttribute("type", "text");
    expect(eye).toHaveAttribute("aria-pressed", "true");
    expect(password).toHaveFocus();

    await user.click(eye);
    expect(password).toHaveAttribute("type", "password");
  });

  it("creates the account under the name the flow already had", async () => {
    auth.registerAction.mockResolvedValue({
      ok: true,
      data: { verificationRequired: false, claimedGroupId: "group-1" },
    });
    const user = userEvent.setup();
    renderWithIntl(<Harness intent="account" codeSignupAvailable={false} />);

    // A name was known, so none is asked.
    expect(
      screen.queryByRole("textbox", { name: strings.nameLabel }),
    ).toBeNull();
    await user.type(
      screen.getByLabelText(strings.emailLabel),
      "ada@example.com",
    );
    await user.type(
      screen.getByLabelText(strings.passwordLabel),
      "analytical engine",
    );
    await user.click(
      screen.getByRole("button", { name: strings.createAccount }),
    );

    expect(auth.registerAction).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "analytical engine",
      proofOfWork: null,
    });
    expect(onDone).toHaveBeenCalledWith({
      credential: "password",
      joinedGroupId: null,
      claimedGroupId: "group-1",
    });
  });

  it("puts the caret back in the address when the server refuses it", async () => {
    auth.registerAction.mockResolvedValue({
      ok: false,
      error: en.serverErrors.emailTaken,
    });
    const user = userEvent.setup();
    renderWithIntl(<Harness intent="account" codeSignupAvailable={false} />);

    const email = screen.getByLabelText(strings.emailLabel);
    await user.type(email, "ada@example.com");
    await user.type(
      screen.getByLabelText(strings.passwordLabel),
      "analytical engine",
    );
    await user.click(
      screen.getByRole("button", { name: strings.createAccount }),
    );

    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.serverErrors.emailTaken,
    );
    expect(email).toHaveAccessibleDescription(en.serverErrors.emailTaken);
    expect(onDone).not.toHaveBeenCalled();
  });

  it("keeps the name and the address out of the password before sending it", async () => {
    const user = userEvent.setup();
    renderWithIntl(<Harness intent="account" codeSignupAvailable={false} />);

    await user.type(
      screen.getByLabelText(strings.emailLabel),
      "ada@example.com",
    );
    const password = screen.getByLabelText(strings.passwordLabel);
    await user.type(password, "lovelace-forever");
    await user.click(
      screen.getByRole("button", { name: strings.createAccount }),
    );

    expect(auth.registerAction).not.toHaveBeenCalled();
    expect(password).toHaveAccessibleDescription(
      `${strings.passwordHint} ${strings.passwordPersonal}`,
    );
  });
});
