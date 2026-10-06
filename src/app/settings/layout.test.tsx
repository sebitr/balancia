import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, within } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import { renderWithIntl } from "../../../tests/helpers/intl";

/**
 * The settings surface around every screen, and what it adds from `lg` up.
 *
 * Below `lg` it adds nothing: the hub and its screens are pages of their own,
 * each drawing its own header. From `lg` the surface draws the hub as a pane
 * beside the screen and the ✕ once along the top of both — still a surface,
 * with no app chrome, and still closing back to wherever settings was opened
 * from. jsdom has no widths, so what is pinned for the breakpoints is which
 * elements each one hides.
 *
 * The layout is a Server Component, called here and its output mounted. The
 * hub's rows are a stand-in: they have tests of their own.
 */

const state = vi.hoisted(() => ({ hubFails: false }));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "userSettings" | "nav") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
  usePathname: () => "/settings/appearance",
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    transitionTypes,
    ...rest
  }: {
    href: string;
    children: ReactNode;
    transitionTypes?: string[];
  }) => (
    <a href={href} data-transition={transitionTypes?.join(" ")} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => ({
    kind: "user",
    userId: "u1",
    name: "Ada",
    email: "ada@example.com",
  }),
}));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ appOrigin: "https://home.lan" }),
}));
vi.mock("@/components/pwa/serwist-register", () => ({
  SerwistRegister: () => null,
}));
vi.mock("@/components/settings/settings-hub", () => ({
  loadSettingsHub: async () => {
    if (state.hubFails) throw new Error("The summaries could not be read");
    return {};
  },
  SettingsHub: () => <a href="/settings/notifications">Notifications</a>,
}));

const { default: SettingsLayout } = await import("./layout");

/** Mounted inside `act`, so the pane's read resolves — or fails — before it returns. */
async function renderSurface() {
  const layout = (await SettingsLayout({
    children: <p>The appearance screen</p>,
    params: Promise.resolve({}),
  } as Parameters<typeof SettingsLayout>[0])) as ReactElement;
  await act(async () => {
    renderWithIntl(layout);
  });
}

beforeEach(() => {
  state.hubFails = false;
  sessionStorage.clear();
});

describe("the settings surface", () => {
  it("draws the screen in the one main landmark", async () => {
    await renderSurface();

    expect(
      within(screen.getByRole("main")).getByText("The appearance screen"),
    ).toBeInTheDocument();
  });

  it("draws its own header and pane from lg only", async () => {
    await renderSurface();

    expect(screen.getByRole("banner")).toHaveClass("hidden", "lg:flex");
    expect(screen.getByRole("navigation", { name: "Settings" })).toHaveClass(
      "hidden",
      "lg:block",
    );
    // The way past the pane, where there is one.
    expect(screen.getByRole("link", { name: "Skip to content" })).toHaveClass(
      "hidden",
      "lg:block",
    );
  });
});

describe("from lg up", () => {
  it("closes back to the screen settings was opened from", async () => {
    // A group's settings, where the avatar was pressed.
    sessionStorage.setItem("balancia:settings-origin", "/groups/g1/settings");

    await renderSurface();

    const close = within(screen.getByRole("banner")).getByRole("link", {
      name: "Close settings",
    });
    expect(close).toHaveAttribute("href", "/groups/g1/settings");
    expect(close).toHaveAttribute("data-transition", "pop");
  });

  it("closes to the dashboard when settings was opened from nowhere", async () => {
    await renderSurface();

    expect(
      within(screen.getByRole("banner")).getByRole("link", {
        name: "Close settings",
      }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("says which account, on which instance", async () => {
    await renderSurface();

    const banner = screen.getByRole("banner");
    expect(
      within(banner).getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeInTheDocument();
    expect(banner).toHaveTextContent(
      "Signed in to home.lan as ada@example.com",
    );
  });

  it("keeps the hub's rows in a pane beside the screen", async () => {
    await renderSurface();

    const pane = screen.getByRole("navigation", { name: "Settings" });
    expect(
      within(pane).getByRole("link", { name: "Notifications" }),
    ).toHaveAttribute("href", "/settings/notifications");
  });

  it("keeps the screen when the pane cannot be read", async () => {
    state.hubFails = true;
    // React reports the error it caught; that report is the expected outcome.
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderSurface();

    // Uncaught, the failure would have taken the whole surface with it.
    expect(screen.getByText("The appearance screen")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Close settings" })).toBeVisible();
    expect(
      screen.getByRole("navigation", { name: "Settings" }),
    ).toBeEmptyDOMElement();

    quiet.mockRestore();
  });
});
