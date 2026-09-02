import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import en from "../../../messages/en.json";

/**
 * The password rules the server enforces, said under the field first.
 *
 * `assertPasswordPolicy` refuses a password everybody guesses and one made of
 * the name or the address. The form used to say only "at least 10 characters",
 * so both refusals arrived as a red banner after the round trip, from a rule
 * nobody had been told about.
 */

const registerAction = vi.fn();
const push = vi.fn();

vi.mock("@/modules/auth/actions", () => ({
  registerAction: (...args: unknown[]) => registerAction(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh: vi.fn() }),
}));
vi.mock("@/components/auth/use-proof-of-work", () => ({
  useProofOfWork: () => ({ solution: async () => null }),
}));

const { RegisterForm } = await import("./register-form");

beforeEach(() => {
  vi.clearAllMocks();
  registerAction.mockResolvedValue({ ok: true, data: {} });
});

async function fillIn(
  user: ReturnType<typeof userEvent.setup>,
  password: string,
) {
  await user.type(screen.getByLabelText("Name"), "Grace Hopper");
  await user.type(screen.getByLabelText("Email"), "grace@example.com");
  await user.type(screen.getByLabelText("Password", { exact: true }), password);
  await user.type(screen.getByLabelText("Confirm password"), password);
  await user.click(screen.getByRole("button", { name: "Create account" }));
}

describe("the password rules", () => {
  it("says the rules before anybody types", () => {
    renderWithIntl(<RegisterForm />);
    expect(screen.getByText(en.register.passwordHint)).toBeInTheDocument();
  });

  it("refuses a password everybody uses, under the field, before submit", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RegisterForm />);

    await fillIn(user, "password1234");

    expect(
      screen.getByText(en.register.validation.passwordCommon),
    ).toBeInTheDocument();
    expect(registerAction).not.toHaveBeenCalled();
  });

  it("refuses a password made of the name or the address", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RegisterForm />);

    await fillIn(user, "hopper-at-sea-99");

    expect(
      screen.getByText(en.register.validation.passwordPersonal),
    ).toBeInTheDocument();
    expect(registerAction).not.toHaveBeenCalled();
  });

  it("sends a password that clears every rule", async () => {
    const user = userEvent.setup();
    renderWithIntl(<RegisterForm />);

    await fillIn(user, "orchid-lantern-42");

    expect(registerAction).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "grace@example.com",
        password: "orchid-lantern-42",
      }),
    );
  });
});
