import { describe, expect, it, vi, beforeEach } from "vitest";
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
const startDemoAction = vi.fn();
const push = vi.fn();
const supportsPasskeyAutofill = vi.fn();
const armPasskeyAutofill = vi.fn();
const cancelPasskeyCeremony = vi.fn();
const signInWithPasskey = vi.fn();

vi.mock("@/modules/auth/actions", () => ({
  signInAction: (...args: unknown[]) => signInAction(...args),
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
  startDemoAction.mockResolvedValue({ ok: true });
  // `clearAllMocks` forgets the calls, not the implementations, so every
  // default is restated here rather than leaking into the next test.
  supportsPasskeyAutofill.mockResolvedValue(false);
  armPasskeyAutofill.mockImplementation(stillOffering);
  signInWithPasskey.mockResolvedValue(undefined);
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
    armPasskeyAutofill.mockResolvedValue(undefined);

    renderWithIntl(<SignInForm mailEnabled={false} />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/dashboard"));
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
