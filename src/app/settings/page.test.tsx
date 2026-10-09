import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import fr from "../../../messages/fr.json";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { DateFormat } from "@/i18n/format";

/**
 * The settings hub: the way out of it, and what its rows say before a tap.
 *
 * The ✕ goes back to the screen settings was opened from, which only the
 * browser knows, and to the dashboard when there is none. The "Money &
 * formats" row names the date notation rather than writing a date in it — a
 * sample date in a summary read as the day something had happened.
 *
 * From `lg` up the hub is the layout's left pane rather than this page, and
 * the page shows the first screen beside it instead; jsdom has no widths, so
 * what is pinned there is which of the two each breakpoint hides.
 *
 * The AI assistants row counts what is connected, and is not drawn at all where
 * the operator has switched agent access off: there would be nowhere to go.
 *
 * The page is a Server Component, called here and its output mounted. The
 * rows whose summaries are drawn by components of their own are stand-ins.
 */

const state = vi.hoisted(() => ({
  locale: "en" as "en" | "fr",
  dateFormat: "auto" as DateFormat,
  currency: "CHF" as string | null,
  agentAccess: true,
  assistants: 0,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "userSettings") =>
    createTranslator({
      locale: state.locale,
      messages: state.locale === "fr" ? fr : en,
      namespace,
    }),
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
    userId: "u1",
    name: "Ada",
    email: "ada@example.com",
  }),
}));
vi.mock("@/lib/security/admin", () => ({ isInstanceAdmin: async () => false }));
vi.mock("@/lib/env", () => ({
  getEnv: () => ({ agentAccessEnabled: state.agentAccess }),
}));
vi.mock("@/modules/agent-access/grants", () => ({
  listConnections: async () =>
    Array.from({ length: state.assistants }, (_, index) => ({
      id: `c${index}`,
    })),
}));
vi.mock("@/lib/telemetry/environment", () => ({ appVersion: () => "1.2.3" }));
vi.mock("@/modules/auth/webauthn", () => ({ listPasskeys: async () => [] }));
vi.mock("@/modules/auth/service", () => ({
  getUserPreferredCurrency: async () => state.currency,
}));
vi.mock("@/modules/groups/service", () => ({
  listGroupsForUser: async () => [],
}));
vi.mock("@/modules/notifications/service", () => ({
  getPreferences: async () => ({ expenses: true, settlements: true }),
}));
vi.mock("@/modules/payouts/service", () => ({
  listPayoutMethods: async () => [],
}));
vi.mock("@/modules/profile/avatar", () => ({
  getAvatarVersion: async () => null,
}));
vi.mock("@/i18n/preferences", () => ({
  resolveFormatPreferences: async () => ({
    dateFormat: state.dateFormat,
    numberFormat: "auto",
    formatLocale: state.locale === "fr" ? "fr" : "en-US",
    numberLocale: state.locale === "fr" ? "fr" : "en-US",
    timeZone: "UTC",
  }),
}));

vi.mock("@/components/settings/identity-card", () => ({
  IdentityCard: () => null,
}));
vi.mock("@/components/settings/appearance-summary", () => ({
  AppearanceSummary: () => null,
}));
vi.mock("@/components/settings/payouts-summary", () => ({
  PayoutsSummary: () => null,
}));
vi.mock("@/components/settings/sign-out-button", () => ({
  SignOutButton: () => null,
}));
// The first screen, which the page shows beside the pane from `lg` up. It is
// a page of its own with tests of its own; here it only has to be findable.
vi.mock("./account/page", () => ({
  default: () => <p>The account screen</p>,
}));

const { default: SettingsHubPage } = await import("./page");

async function renderHub() {
  const page = (await SettingsHubPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve({}),
  })) as ReactElement;
  return renderWithIntl(page, { locale: state.locale });
}

/** The summary drawn at the end of a row, found from the row's own label. */
function summaryOf(label: string): string | null | undefined {
  return screen.getByText(label).parentElement?.nextElementSibling?.textContent;
}

beforeEach(() => {
  state.locale = "en";
  state.dateFormat = "auto";
  state.currency = "CHF";
  state.agentAccess = true;
  state.assistants = 0;
  sessionStorage.clear();
});

describe("the hub's ✕", () => {
  it("goes back to the screen settings was opened from", async () => {
    sessionStorage.setItem("balancia:settings-origin", "/groups/g1");

    await renderHub();

    const close = screen.getByRole("link", { name: "Close settings" });
    expect(close).toHaveAttribute("href", "/groups/g1");
    // The way back out, so it moves as the arrows do.
    expect(close).toHaveAttribute("data-transition", "pop");
  });

  it("goes to the dashboard when there is nowhere to go back to", async () => {
    // A link in an email, opened in a tab of its own.
    await renderHub();

    expect(
      screen.getByRole("link", { name: "Close settings" }),
    ).toHaveAttribute("href", "/dashboard");
  });

  it("will not lead off the site, whatever was left in the store", async () => {
    sessionStorage.setItem("balancia:settings-origin", "//evil.example");

    await renderHub();

    expect(
      screen.getByRole("link", { name: "Close settings" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});

describe("from lg up", () => {
  it("hides the hub, which the surface draws as the pane beside the screen", async () => {
    await renderHub();

    // The phone's hub — its name, its ✕, its rows — is the page below `lg`
    // and nothing above it: the layout draws all three there itself.
    const heading = screen.getByRole("heading", { level: 1, name: "Settings" });
    expect(heading.closest(".lg\\:hidden")).not.toBeNull();
    expect(
      screen.getByText("Money & formats").closest(".lg\\:hidden"),
    ).not.toBeNull();
  });

  it("shows the first screen in the right pane rather than an empty half", async () => {
    await renderHub();

    const first = screen.getByText("The account screen");
    expect(first.closest(".hidden.lg\\:block")).not.toBeNull();
    expect(first.closest(".lg\\:hidden")).toBeNull();
  });
});

describe("the Money & formats row", () => {
  it("names a chosen date notation rather than writing a date in it", async () => {
    state.dateFormat = "dmy";

    await renderHub();

    expect(summaryOf("Money & formats")).toBe("CHF · DD/MM/YYYY");
  });

  it("says Automatic when the notation follows the browser", async () => {
    await renderHub();

    expect(summaryOf("Money & formats")).toBe("CHF · Automatic");
  });

  it("names every notation, and never shows a date", async () => {
    const shown: string[] = [];
    for (const format of ["auto", "dmy", "mdy", "ymd"] as const) {
      state.dateFormat = format;
      const { unmount } = await renderHub();
      shown.push(summaryOf("Money & formats") ?? "");
      unmount();
    }

    expect(shown).toEqual([
      "CHF · Automatic",
      "CHF · DD/MM/YYYY",
      "CHF · MM/DD/YYYY",
      "CHF · YYYY-MM-DD",
    ]);
    expect(shown.join(" ")).not.toMatch(/2026|Aug/);
  });

  it("names it in French in French", async () => {
    state.locale = "fr";
    state.dateFormat = "dmy";
    state.currency = null;

    await renderHub();

    // The same fallback currency the screen behind the row shows.
    expect(summaryOf("Devise et formats")).toBe("EUR · JJ/MM/AAAA");
  });
});

describe("the AI assistants row", () => {
  it("leads to the screen of its own", async () => {
    await renderHub();

    expect(screen.getByText("AI assistants").closest("a")).toHaveAttribute(
      "href",
      "/settings/assistants",
    );
  });

  it("counts what is connected, and says None rather than 0", async () => {
    const shown: string[] = [];
    for (const count of [0, 1, 3]) {
      state.assistants = count;
      const { unmount } = await renderHub();
      shown.push(summaryOf("AI assistants") ?? "");
      unmount();
    }

    expect(shown).toEqual(["None", "1 connected", "3 connected"]);
  });

  it("is not drawn where agent access is switched off", async () => {
    state.agentAccess = false;

    await renderHub();

    expect(screen.queryByText("AI assistants")).not.toBeInTheDocument();
    expect(screen.getByText("Sign-in & security")).toBeInTheDocument();
  });

  it("is named in French in French", async () => {
    state.locale = "fr";
    state.assistants = 2;

    await renderHub();

    expect(summaryOf("Assistants IA")).toBe("2 connectés");
  });
});
