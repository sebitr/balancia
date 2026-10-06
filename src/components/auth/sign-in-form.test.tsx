import { describe, expect, it, vi, beforeEach, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import en from "../../../messages/en.json";

/**
 * The sign-in form, in the two places it would otherwise fail silently.
 *
 * The first is the demo instance: the form validates the email field with
 * `z.email`, and the credential a demo tells people to type — `demo` — is not
 * an address. Without the relaxed schema the button works and typing what the
 * page says does not, which is exactly the half-broken state nobody would test
 * by hand.
 *
 * The second is passkey autofill, which has no visible surface at all. The
 * browser owns the dropdown, so the only thing observable from here is whether
 * the page armed a conditional request and what it did when one settled.
 */

const signInAction = vi.fn();
const requestSignInCodeAction = vi.fn();
const signInWithCodeAction = vi.fn();
const startDemoAction = vi.fn();
const push = vi.fn();
const supportsPasskeyAutofill = vi.fn();
const armPasskeyAutofill = vi.fn();
const cancelPasskeyCeremony = vi.fn();
const signInWithPasskey = vi.fn();
const upgradeToPasskey = vi.fn();

vi.mock("@/modules/auth/actions", () => ({
  signInAction: (...args: unknown[]) => signInAction(...args),
  requestSignInCodeAction: (...args: unknown[]) =>
    requestSignInCodeAction(...args),
  signInWithCodeAction: (...args: unknown[]) => signInWithCodeAction(...args),
}));
vi.mock("@/modules/demo/actions", () => ({
  startDemoAction: (...args: unknown[]) => startDemoAction(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("./use-passkey-support", () => ({ usePasskeySupport: () => false }));
vi.mock("@/modules/auth/passkey-client", () => ({
  supportsPasskeyAutofill: () => supportsPasskeyAutofill(),
  armPasskeyAutofill: () => armPasskeyAutofill(),
  cancelPasskeyCeremony: () => cancelPasskeyCeremony(),
  signInWithPasskey: () => signInWithPasskey(),
  upgradeToPasskey: () => upgradeToPasskey(),
}));

const { SignInForm } = await import("./sign-in-form");

/** A ceremony that is offering the passkey and has settled on nothing. */
const stillOffering = (): Promise<never> => new Promise<never>(() => {});

const named = (name: string, message: string): Error => {
  const error = new Error(message);
  error.name = name;
  return error;
};

beforeEach(() => {
  vi.clearAllMocks();
  signInAction.mockResolvedValue({ ok: true });
  requestSignInCodeAction.mockResolvedValue({ ok: true });
  signInWithCodeAction.mockResolvedValue({
    ok: true,
    data: { joinedGroupId: null, claimedGroupId: null, taken: false },
  });
  startDemoAction.mockResolvedValue({ ok: true });
  // `clearAllMocks` forgets the calls, not the implementations, so every
  // default is restated here rather than leaking into the next test.
  supportsPasskeyAutofill.mockResolvedValue(false);
  armPasskeyAutofill.mockImplementation(stillOffering);
  signInWithPasskey.mockResolvedValue(undefined);
});

/**
 * Somebody who followed a group's address with no account to sign in with.
 * The page decides whether they did (`sign-in/page.test.tsx`); the form only
 * says it, above everything it asks for.
 */
describe("arriving from a group's page", () => {
  it("says the group is private and what to ask for", () => {
    renderWithIntl(<SignInForm mailEnabled={false} privateGroup />);

    const line = screen.getByText(en.auth.signIn.privateGroup);
    expect(line).toBeInTheDocument();
    // Above the form, so it is read before the password field is.
    expect(
      line.compareDocumentPosition(screen.getByLabelText("Email address")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Information, not a failure: nothing is announced as an alert.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing of the kind otherwise", () => {
    renderWithIntl(<SignInForm mailEnabled={false} />);

    expect(
      screen.queryByText(en.auth.signIn.privateGroup),
    ).not.toBeInTheDocument();
  });
});

describe("on a real instance", () => {
  it("offers no way into a demo", () => {
    renderWithIntl(<SignInForm mailEnabled={false} />);

    expect(
      screen.queryByRole("button", { name: /try the demo/i }),
    ).not.toBeInTheDocument();
  });

  it("still insists on an email address", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} />);

    await user.type(screen.getByLabelText(/email/i), "demo");
    await user.type(screen.getByLabelText(/password/i), "demo");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    expect(signInAction).not.toHaveBeenCalled();
  });
});

/**
 * The way in for an account that has no password.
 *
 * A code or a passkey signup leaves no password behind, and on a new device
 * this page used to answer such an account with "Incorrect email or
 * password" and nothing else. Where the instance can mail, a code is offered
 * on the same screen and uses the address already typed.
 */
describe("signing in with a code", () => {
  it("is offered only where the instance can send mail", () => {
    const { unmount } = renderWithIntl(<SignInForm mailEnabled={false} />);
    expect(
      screen.queryByRole("button", { name: /sign-in code/i }),
    ).not.toBeInTheDocument();
    unmount();

    renderWithIntl(<SignInForm mailEnabled />);
    expect(
      screen.getByRole("button", { name: /sign-in code/i }),
    ).toBeInTheDocument();
  });

  it("asks for an address before it mails anything", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.click(screen.getByRole("button", { name: /sign-in code/i }));

    expect(requestSignInCodeAction).not.toHaveBeenCalled();
    expect(screen.getByText(en.auth.validation.email)).toBeInTheDocument();
  });

  it("mails the typed address, takes the six digits, and goes to the dashboard", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /sign-in code/i }));

    expect(requestSignInCodeAction).toHaveBeenCalledWith({
      email: "ada@example.com",
    });
    // The password field steps aside for the code.
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    const resend = screen.getByRole("button", { name: /Send another code/ });
    expect(resend).toBeDisabled();

    await user.type(screen.getByLabelText("The six-digit code"), "123456");

    await waitFor(() =>
      expect(signInWithCodeAction).toHaveBeenCalledWith({
        email: "ada@example.com",
        code: "123456",
      }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("points a refused password at the code", async () => {
    signInAction.mockResolvedValue({
      ok: false,
      error: en.serverErrors.invalidCredentials,
    });
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "not-the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(
      await screen.findByText(en.serverErrors.invalidCredentials),
    ).toBeInTheDocument();
    expect(screen.getByText(en.auth.signIn.noPasswordHint)).toBeInTheDocument();
  });

  it("lets the reader go back to the password", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /sign-in code/i }));
    await user.click(
      screen.getByRole("button", { name: en.auth.signIn.usePassword }),
    );

    expect(screen.getByLabelText("Password")).toBeInTheDocument();
    expect(screen.getByLabelText("Email address")).toHaveValue(
      "ada@example.com",
    );
  });
});

/**
 * Where the caret is after the server says no.
 *
 * The submit button is disabled while the request is out, and a focused
 * control that becomes disabled lets go of focus — so a wrong password used
 * to leave a keyboard on the page body, with both fields still filled in and
 * no way back to them but Tab from the top. The caret goes to the field to
 * retype, with its contents selected, and only once the refusal is on screen
 * for a screen reader to have announced.
 */
describe("after a refused attempt", () => {
  /**
   * Holds the server's next answer back, so the test can look at the form
   * while the request is still out and then hand it the refusal.
   */
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

  /** The alert's text at the moment `field` takes focus, or null if none. */
  function alertWhenFocused(field: HTMLElement): () => string | null {
    let seen: string | null = null;
    field.addEventListener("focus", () => {
      seen = document.querySelector('[role="alert"]')?.textContent ?? null;
    });
    return () => seen;
  }

  it("puts the caret back in the password, selected, once the refusal is shown", async () => {
    const answer = answerLater(signInAction);
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} />);

    const email = screen.getByLabelText("Email address");
    const password = screen.getByLabelText<HTMLInputElement>("Password");
    await user.type(email, "ada@example.com");
    await user.type(password, "not-the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signInAction).toHaveBeenCalled());

    const seen = alertWhenFocused(password);
    expect(password).not.toHaveFocus();
    answer({ ok: false, error: en.serverErrors.invalidCredentials });

    await waitFor(() => expect(password).toHaveFocus());
    // The refusal was already on screen when the caret arrived.
    expect(seen()).toBe(en.serverErrors.invalidCredentials);
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.serverErrors.invalidCredentials,
    );
    // Selected, so typing replaces the attempt rather than adding to it.
    expect(password.selectionStart).toBe(0);
    expect(password.selectionEnd).toBe("not-the-password".length);
    // Nothing the reader typed is thrown away.
    expect(email).toHaveValue("ada@example.com");
    // And the field carries the reason, for a screen reader that stopped
    // reading the alert to announce the field.
    expect(password).toHaveAccessibleDescription(
      en.serverErrors.invalidCredentials,
    );
    expect(email).not.toHaveAccessibleDescription(
      en.serverErrors.invalidCredentials,
    );
  });

  it("does it again on the next refusal", async () => {
    signInAction.mockResolvedValue({
      ok: false,
      error: en.serverErrors.invalidCredentials,
    });
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "first-try");
    const submit = screen.getByRole("button", { name: "Sign in" });
    await user.click(submit);
    await waitFor(() =>
      expect(screen.getByLabelText("Password")).toHaveFocus(),
    );

    await user.keyboard("second-try");
    await user.click(submit);

    expect(signInAction).toHaveBeenLastCalledWith({
      email: "ada@example.com",
      password: "second-try",
    });
    await waitFor(() =>
      expect(screen.getByLabelText("Password")).toHaveFocus(),
    );
  });

  it("puts it in the address when the address is what was refused", async () => {
    const answer = answerLater(signInAction);
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} />);

    const email = screen.getByLabelText("Email address");
    await user.type(email, "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await waitFor(() => expect(signInAction).toHaveBeenCalled());

    const seen = alertWhenFocused(email);
    answer({
      ok: false,
      error: en.serverErrors.emailUnverified,
      code: "emailUnverified",
    });

    await waitFor(() => expect(email).toHaveFocus());
    expect(seen()).toBe(en.serverErrors.emailUnverified);
    expect(email).toHaveAccessibleDescription(en.serverErrors.emailUnverified);
  });

  it("puts it in the address when the address is not one", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.type(screen.getByLabelText("Email address"), "ada@");
    await user.type(screen.getByLabelText("Password"), "the-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));

    expect(signInAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("Email address")).toHaveFocus(),
    );
  });

  it("puts it in the address when a code is asked for without one", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.click(screen.getByRole("button", { name: /sign-in code/i }));

    expect(requestSignInCodeAction).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByLabelText("Email address")).toHaveFocus(),
    );
  });

  it("puts it in the address when no code could be sent to it", async () => {
    requestSignInCodeAction.mockResolvedValue({
      ok: false,
      error: en.serverErrors.rateLimited,
    });
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    const email = screen.getByLabelText("Email address");
    await user.type(email, "ada@example.com");
    await user.click(screen.getByRole("button", { name: /sign-in code/i }));

    await waitFor(() => expect(email).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent(
      en.serverErrors.rateLimited,
    );
  });

  it("puts it back in the emptied boxes after a wrong code", async () => {
    const answer = answerLater(signInWithCodeAction);
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled />);

    await user.type(screen.getByLabelText("Email address"), "ada@example.com");
    await user.click(screen.getByRole("button", { name: /sign-in code/i }));
    const boxes = screen.getByLabelText("The six-digit code");
    await user.type(boxes, "123456");
    await waitFor(() => expect(signInWithCodeAction).toHaveBeenCalled());

    const seen = alertWhenFocused(boxes);
    // A browser lets go of the boxes' focus as they are disabled for the
    // check; jsdom keeps it, and will not even blur a disabled control. So
    // the caret is put somewhere else by hand, as a browser would have left
    // it nowhere, and has to come back.
    const elsewhere = document.body.appendChild(
      document.createElement("button"),
    );
    elsewhere.focus();
    answer({ ok: false, error: en.auth.signIn.codeWrong });

    await waitFor(() => expect(boxes).toHaveFocus());
    elsewhere.remove();
    expect(seen()).toBe(en.auth.signIn.codeWrong);
    expect(boxes).toHaveValue("");
    expect(boxes).toHaveAccessibleDescription(en.auth.signIn.codeWrong);
  });
});

describe("on a demo instance", () => {
  it("takes the visitor in with one click", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} demoMode />);

    await user.click(screen.getByRole("button", { name: /try the demo/i }));

    expect(startDemoAction).toHaveBeenCalledOnce();
    expect(push).toHaveBeenCalledWith("/dashboard");
  });

  it("accepts demo / demo typed into the form", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} demoMode />);

    await user.type(screen.getByLabelText(/email/i), "demo");
    await user.type(screen.getByLabelText(/password/i), "demo");
    await user.click(screen.getByRole("button", { name: /^sign in$/i }));

    // Through signInAction, which recognises the credential server-side and
    // hands off to the demo. The point of the assertion is that the form let
    // it through at all.
    expect(signInAction).toHaveBeenCalledWith({
      email: "demo",
      password: "demo",
    });
  });

  it("says what the demo is before anyone commits to it", () => {
    renderWithIntl(<SignInForm mailEnabled={false} demoMode />);

    expect(screen.getByText(/nothing is kept/i)).toBeInTheDocument();
  });
});

describe("passkey autofill", () => {
  it("arms a conditional request where the browser offers one", async () => {
    supportsPasskeyAutofill.mockResolvedValue(true);

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(armPasskeyAutofill).toHaveBeenCalledOnce());
  });

  it("arms nothing where it does not", async () => {
    supportsPasskeyAutofill.mockResolvedValue(false);

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(supportsPasskeyAutofill).toHaveBeenCalledOnce());
    expect(armPasskeyAutofill).not.toHaveBeenCalled();
  });

  it("goes to the dashboard when the passkey is picked from the dropdown", async () => {
    supportsPasskeyAutofill.mockResolvedValue(true);
    armPasskeyAutofill.mockResolvedValue(true);

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
  });

  it("stays put when the request never armed", async () => {
    supportsPasskeyAutofill.mockResolvedValue(true);
    // False is the options handout refusing — the rate limiter, most likely,
    // which somebody flicking between tabs can reach without doing anything
    // wrong. Nothing was offered, so nothing was picked.
    armPasskeyAutofill.mockResolvedValue(false);

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(armPasskeyAutofill).toHaveBeenCalledOnce());
    expect(push).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says nothing when the request is aborted", async () => {
    supportsPasskeyAutofill.mockResolvedValue(true);
    // What the passkey button raises on the pending request as it starts its
    // own ceremony, and what unmounting raises. Nobody asked for either.
    armPasskeyAutofill.mockRejectedValue(named("AbortError", "cancelled"));

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(armPasskeyAutofill).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("says nothing when there was no authenticator to offer", async () => {
    supportsPasskeyAutofill.mockResolvedValue(true);
    // `NotAllowedError` on the armed request means a browser with nothing to
    // put in the dropdown, or somebody dismissing a prompt they never
    // summoned. Either way it is a refusal of something nobody asked for, and
    // it was showing up as "That passkey request was cancelled" over a form
    // the reader had only just opened.
    armPasskeyAutofill.mockRejectedValue(named("NotAllowedError", "no"));

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(armPasskeyAutofill).toHaveBeenCalledOnce());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("fetches a fresh challenge once when the first has expired", async () => {
    supportsPasskeyAutofill.mockResolvedValue(true);
    armPasskeyAutofill.mockRejectedValue(
      new Error(en.serverErrors.passkeySignInExpired),
    );

    renderWithIntl(<SignInForm mailEnabled={false} />);

    // The second refusal is reported rather than retried, which is how a
    // server that expires every challenge stops here instead of looping.
    await waitFor(() =>
      expect(
        screen.getByText(en.serverErrors.passkeySignInExpired),
      ).toBeInTheDocument(),
    );
    expect(armPasskeyAutofill).toHaveBeenCalledTimes(2);
  });
});
