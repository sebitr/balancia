import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { FallbacksCard } from "./fallbacks-card";
import { PasskeysCard } from "./passkeys-card";

/**
 * The two questions the security screen asks before it takes a way in away.
 *
 * Both used to offer "Keep it" as the way out — keep what? Each now names
 * what answering no keeps, and answering no takes nothing away.
 */

const { removePasskey, unlinkAppleAction } = vi.hoisted(() => ({
  removePasskey: vi.fn(),
  unlinkAppleAction: vi.fn(),
}));

vi.mock("@/modules/auth/passkey-client", () => ({
  fetchPasskeys: async () => [
    {
      id: "pk1",
      name: "Ada's iPhone",
      deviceType: "multiDevice",
      backedUp: true,
      aaguid: null,
      createdAt: "2026-08-01T10:00:00.000Z",
      lastUsedAt: null,
    },
  ],
  registerPasskey: vi.fn(),
  removePasskey,
  supportsPasskeys: () => true,
}));
vi.mock("@/modules/auth/actions", () => ({
  changePasswordAction: vi.fn(),
  unlinkAppleAction,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

function withQueries(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return <QueryClientProvider client={client}>{ui}</QueryClientProvider>;
}

describe("removing a passkey", () => {
  it("offers to keep it, by name", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      withQueries(
        <PasskeysCard
          relyingPartyId="balancia.test"
          secureContext
          hasOtherWayIn
        />,
      ),
    );

    await user.click(
      await screen.findByRole("button", { name: "Remove Ada's iPhone" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep this passkey" }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(removePasskey).not.toHaveBeenCalled();
  });
});

describe("unlinking Apple", () => {
  it("offers to keep signing in with Apple", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FallbacksCard hasPassword appleEnabled appleLinked />);

    await user.click(screen.getByRole("button", { name: "Unlink" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Keep Apple sign-in" }),
    );

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(unlinkAppleAction).not.toHaveBeenCalled();
  });

  it("says so in French in French", async () => {
    const user = userEvent.setup();
    renderWithIntl(<FallbacksCard hasPassword appleEnabled appleLinked />, {
      locale: "fr",
    });

    await user.click(screen.getByRole("button", { name: "Dissocier" }));
    expect(
      await screen.findByRole("button", {
        name: "Garder la connexion avec Apple",
      }),
    ).toBeInTheDocument();
  });
});
