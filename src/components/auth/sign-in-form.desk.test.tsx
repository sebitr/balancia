import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderToString } from "react-dom/server";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { renderWithIntl } from "../../../tests/helpers/intl";
import en from "../../../messages/en.json";

/**
 * The sign-in form from `lg` up, where the passkey leads.
 *
 * jsdom runs no media queries, so what is held here is what the two widths
 * are told — which button is drawn at the head and which in the list below,
 * each hidden at the other's widths — and that both are the one passkey
 * sign-in. The form's own behaviour is `sign-in-form.test.tsx`'s.
 */

const passkeySupport = vi.fn(() => true);
const signInWithPasskey = vi.fn();

vi.mock("@/modules/auth/actions", () => ({
  signInAction: vi.fn(),
  requestSignInCodeAction: vi.fn(),
  signInWithCodeAction: vi.fn(),
}));
vi.mock("@/modules/demo/actions", () => ({ startDemoAction: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./use-passkey-support", () => ({
  usePasskeySupport: () => passkeySupport(),
}));
vi.mock("@/modules/auth/passkey-client", () => ({
  supportsPasskeyAutofill: async () => false,
  armPasskeyAutofill: () => new Promise<never>(() => {}),
  cancelPasskeyCeremony: vi.fn(),
  signInWithPasskey: () => signInWithPasskey(),
  upgradeToPasskey: vi.fn(),
}));

const { SignInForm } = await import("./sign-in-form");

beforeEach(() => {
  vi.clearAllMocks();
  passkeySupport.mockReturnValue(true);
  signInWithPasskey.mockResolvedValue(undefined);
});

const passkeyButtons = () =>
  screen.getAllByRole("button", { name: en.auth.signIn.withPasskey });

describe("on a browser that can do passkeys", () => {
  it("draws the passkey at the head from lg, and in the list below it", () => {
    renderWithIntl(<SignInForm mailEnabled />);

    const [head, list] = passkeyButtons();
    const email = screen.getByLabelText("Email address");

    // The head's comes before the address; the list's after it.
    expect(
      head!.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      list!.compareDocumentPosition(email) & Node.DOCUMENT_POSITION_PRECEDING,
    ).toBeTruthy();
    // One per width, never both.
    expect(head!.parentElement).toHaveClass("hidden", "lg:block");
    expect(list).toHaveClass("lg:hidden");
  });

  it("fills the passkey and steps the password's submit back from lg", () => {
    renderWithIntl(<SignInForm mailEnabled />);

    const [head] = passkeyButtons();
    expect(head).toHaveAttribute("data-variant", "default");
    expect(screen.getByRole("button", { name: "Sign in" })).toHaveClass(
      "lg:bg-background",
    );
  });

  it("says or once, above the address, from lg", () => {
    renderWithIntl(<SignInForm mailEnabled />);

    const rules = screen.getAllByText(en.common.or);
    expect(rules).toHaveLength(2);
    expect(rules[0]!.parentElement!.parentElement).toHaveClass("lg:block");
    expect(rules[1]!.parentElement).toHaveClass("lg:hidden");
    // The code it is still worth offering stays under the submit.
    expect(
      screen.getByRole("button", { name: en.auth.signIn.emailMeACode }),
    ).toBeInTheDocument();
  });

  it("signs in with the passkey from either of them", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SignInForm mailEnabled={false} />);

    await user.click(passkeyButtons()[0]!);
    expect(signInWithPasskey).toHaveBeenCalledTimes(1);
  });
});

describe("on a browser that cannot", () => {
  it("keeps the phone's order at every width", () => {
    passkeySupport.mockReturnValue(false);
    renderWithIntl(<SignInForm mailEnabled />);

    expect(
      screen.queryByRole("button", { name: en.auth.signIn.withPasskey }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Sign in" })).not.toHaveClass(
      "lg:bg-background",
    );
    expect(screen.getByText(en.common.or).parentElement).not.toHaveClass(
      "lg:hidden",
    );
  });
});

/**
 * Before the browser has been asked — on the server, and through hydration —
 * the passkey is assumed, so the form is painted where it will stay on nearly
 * every browser instead of being pushed down when the answer arrives.
 */
describe("before the browser has answered", () => {
  it("paints the passkey at the head of the form", () => {
    // What the server snapshot says: nobody has asked the browser yet.
    passkeySupport.mockReturnValue(false);

    const html = renderToString(
      <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
        <SignInForm mailEnabled={false} />
      </NextIntlClientProvider>,
    );

    const host = document.createElement("div");
    host.innerHTML = html;
    document.body.append(host);
    try {
      const head = within(host).getByRole("button", {
        name: en.auth.signIn.withPasskey,
      });
      expect(
        head.compareDocumentPosition(
          within(host).getByLabelText("Email address"),
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    } finally {
      host.remove();
    }
  });
});
