import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * The sign-in form on a demo instance.
 *
 * What matters here is the thing that would otherwise fail silently: the form
 * validates the email field with `z.email`, and the credential a demo tells
 * people to type — `demo` — is not an address. Without the relaxed schema the
 * button works and typing what the page says does not, which is exactly the
 * half-broken state nobody would test by hand.
 */

const signInAction = vi.fn();
const startDemoAction = vi.fn();
const push = vi.fn();

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

const { SignInForm } = await import("./sign-in-form");

beforeEach(() => {
  vi.clearAllMocks();
  signInAction.mockResolvedValue({ ok: true });
  startDemoAction.mockResolvedValue({ ok: true });
});

describe("on a real instance", () => {
  it("offers no way into a demo", () => {
    renderWithIntl(<SignInForm mailEnabled={false} />);

    expect(
      screen.queryByRole("button", { name: /enter the demo/i }),
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

    await user.click(screen.getByRole("button", { name: /enter the demo/i }));

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

    expect(screen.getByText(/nothing here is saved/i)).toBeInTheDocument();
  });
});
