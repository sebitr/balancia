import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../../messages/en.json";
import fr from "../../../../../messages/fr.json";
import { renderWithIntl } from "../../../../../tests/helpers/intl";
import { TILES } from "../../../../../tests/helpers/setup-wizard";
import type { BackupScreen } from "@/modules/backup/view";
import BackupSetupPage from "./page";

/**
 * The setup page: what it asks the server, and what it hands the wizard.
 *
 * A Server Component, called here and its output mounted. The rules about
 * which step an address may land on have their own tests (`resolve.test.ts`);
 * what is pinned here is the wiring — that the screen's facts reach those
 * rules in the shape they expect, that a refusal is a redirect or a 404 and
 * not a half-drawn wizard, and that the screen around the wizard says the
 * right thing for the step.
 */

const state = vi.hoisted(() => ({
  locale: "en" as "en" | "fr",
  screen: undefined as unknown,
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "cloudBackup") =>
    createTranslator({
      locale: state.locale,
      messages: state.locale === "fr" ? fr : en,
      namespace,
    }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  useRouter: () => state.router,
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
  getCurrentUser: async () => ({ userId: "u1", name: "Ada", email: "a@b.c" }),
}));
vi.mock("@/modules/backup/view", () => ({
  loadBackupScreen: async () => state.screen,
}));
vi.mock("@/modules/backup/actions", () => ({
  saveRecoveryKeyAction: vi.fn(),
  testDestinationAction: vi.fn(),
  createDestinationAction: vi.fn(),
  finishSetupAction: vi.fn(),
  estimateReceiptsAction: vi.fn(),
  removeDestinationAction: vi.fn(),
}));
vi.mock("@/modules/backup/age", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/backup/age")>()),
  createRecoveryKey: async () => ({
    identity:
      "AGE-SECRET-KEY-1QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7LQPZRY9X8GF2TVDW0S3JN54KHCE",
    recipient: "age1fixedrecipientforthetests",
  }),
}));

const DROPBOX = {
  id: "d1",
  provider: "dropbox",
  label: "Dropbox · ada@example.com",
  frequency: "weekly",
  keepLast: 20,
  excludedGroupIds: [],
  includeReceipts: false,
  status: "active",
} as const;

const PENDING = {
  id: "p1",
  provider: "google_drive",
  label: "Google Drive · ada@example.com",
  status: "setup",
} as const;

function serverScreen(overrides: Partial<BackupScreen> = {}) {
  state.screen = {
    available: true,
    key: { fingerprint: "9f3a07c2", createdAt: new Date("2026-10-01") },
    destinations: [],
    pendingSetup: null,
    canAddDestination: true,
    providers: TILES,
    ownedGroups: [
      {
        id: "g1",
        name: "Lisbon, March",
        participantCount: 4,
        archived: false,
        lastActivityAt: new Date("2026-09-12T10:00:00.000Z"),
      },
      {
        id: "g2",
        name: "Flat",
        participantCount: 3,
        archived: false,
        lastActivityAt: null,
      },
    ],
    receipts: { count: 0, bytes: 0 },
    allowPrivateEndpoints: false,
    ...overrides,
  };
}

async function visit(query: Record<string, string | string[]> = {}) {
  const ui = (await BackupSetupPage({
    searchParams: Promise.resolve(query),
  })) as ReactElement;
  return renderWithIntl(ui, { locale: state.locale });
}

describe("the setup page", () => {
  beforeEach(() => {
    state.locale = "en";
    serverScreen();
  });

  it("says so, and offers no wizard, where cloud backup is not installed", async () => {
    serverScreen({ available: false });
    await visit();

    expect(
      screen.getByText("Cloud backup is not installed on this server"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cloud backup is not installed on this server. Ask your administrator.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Step \d of \d$/)).toBeNull();
  });

  describe("somebody who already has a destination", () => {
    it("goes to the overview", async () => {
      serverScreen({ destinations: [DROPBOX as never] });
      await expect(visit()).rejects.toThrow("REDIRECT /settings/backup");
    });

    it("stays to change it, and starts from what it does now", async () => {
      serverScreen({ destinations: [DROPBOX as never] });
      await visit({ step: "where", replace: "d1" });

      expect(
        screen.getByText(/The new place takes over from Dropbox/),
      ).toBeInTheDocument();
    });

    it("is told there is no such destination when the address names another", async () => {
      serverScreen({ destinations: [DROPBOX as never] });
      await expect(visit({ replace: "d2" })).rejects.toThrow("NOT_FOUND");
    });

    it("may make a new key, under the new key's own title", async () => {
      serverScreen({ destinations: [DROPBOX as never] });
      await visit({ rotate: "1" });

      expect(
        screen.getByRole("heading", {
          level: 1,
          name: "Create a new recovery key",
        }),
      ).toBeInTheDocument();
      expect(
        await screen.findByText("Your new recovery key"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/^Step \d of \d$/)).toBeNull();
    });
  });

  describe("the screen around the wizard", () => {
    it("is titled for the setup, and its arrow leaves the wizard from the first step", async () => {
      await visit();

      expect(
        screen.getByRole("heading", { level: 1, name: "Set up cloud backup" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
        "href",
        "/settings/backup",
      );
    });

    it("has its arrow go to the step before", async () => {
      await visit({ step: "connect", provider: "s3" });

      expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
        "href",
        "/settings/backup/setup?step=where&provider=s3",
      );
    });
  });

  describe("the wizard it hands over to", () => {
    it("starts at the key for somebody who has none", async () => {
      serverScreen({ key: null });
      await visit();

      expect(
        await screen.findByText("Create your recovery key"),
      ).toBeInTheDocument();
      expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    });

    it("skips the key for somebody who has one, even when asked for it", async () => {
      await visit({ step: "key" });

      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
      expect(
        screen.getByRole("heading", { name: "Choose where to back up" }),
      ).toBeInTheDocument();
    });

    it("lists the groups the person owns, with their dates as text", async () => {
      serverScreen({ pendingSetup: PENDING as never });
      await visit({
        step: "what",
        provider: "google_drive",
        connected: "p1",
      });

      const rows = screen.getAllByRole("checkbox");
      expect(rows.map((row) => row.closest("label")?.textContent)).toEqual([
        expect.stringContaining("Lisbon, March"),
        expect.stringContaining("Flat"),
      ]);
      expect(screen.getByText("2 of 2 groups")).toBeInTheDocument();
    });

    it("does not take a connection that is not the one waiting", async () => {
      serverScreen({ pendingSetup: PENDING as never });
      await visit({
        step: "what",
        provider: "google_drive",
        connected: "somebody-elses",
      });

      expect(
        screen.getByRole("heading", { name: "Connect Google Drive" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Continue" })).toBeDisabled();
    });

    it("draws the connection that is waiting as connected", async () => {
      serverScreen({ pendingSetup: PENDING as never });
      await visit({
        step: "connect",
        provider: "google_drive",
        connected: "p1",
      });

      expect(
        screen.getByText("Connected to Google Drive as ada@example.com"),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
    });

    it("shows what the provider said on the way back", async () => {
      await visit({
        step: "connect",
        provider: "google_drive",
        connect: "denied",
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Access wasn't allowed",
      );
    });

    it("does not offer a provider this server has switched off", async () => {
      serverScreen({
        providers: TILES.map((tile) =>
          tile.id === "dropbox"
            ? { ...tile, availability: "needs_operator" as const }
            : tile,
        ),
      });
      await visit({ step: "connect", provider: "dropbox" });

      // The address names it; the server does not offer it; so nobody lands there.
      expect(
        screen.getByRole("heading", { name: "Choose where to back up" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "Dropbox" })).toBeDisabled();
    });
  });

  describe("in French", () => {
    it.each([
      ["the key", { step: "key" }, { key: null }],
      ["where", { step: "where" }, {}],
      ["an account", { step: "connect", provider: "google_drive" }, {}],
      ["a bucket", { step: "connect", provider: "s3" }, {}],
      ["Infomaniak", { step: "connect", provider: "infomaniak" }, {}],
      ["Proton Drive", { step: "connect", provider: "proton_drive" }, {}],
      [
        "what to back up",
        { step: "what", provider: "google_drive", connected: "p1" },
        { pendingSetup: PENDING as never },
      ],
    ])("has every word for %s", async (_name, query, overrides) => {
      state.locale = "fr";
      serverScreen(overrides);
      const { container } = await visit(query);
      await screen.findAllByRole("heading");

      // A message the catalogue lacks is printed as its own key.
      expect(container.textContent).not.toMatch(
        /\b(cloudBackup|userSettings|common)\.[a-zA-Z]/,
      );
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        /sauvegarde/i,
      );
    });
  });
});
