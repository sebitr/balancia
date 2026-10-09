import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createTranslator } from "use-intl/core";
import en from "../../../../messages/en.json";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { destination, run } from "@/components/backup/overview/fixtures";
import type { RunView } from "@/modules/backup/service";
import type { BackupScreen } from "@/modules/backup/view";

/**
 * The page that decides which of the screens this is.
 *
 * Unavailable, nothing set up yet, or an overview — and above the overview the
 * one sentence an OAuth return may leave behind. It is a Server Component,
 * called here and its output mounted; the components under it have tests of
 * their own, so what these pin is what the page reads and what it hands down.
 */

const state = vi.hoisted(() => ({
  screen: null as unknown as BackupScreen,
  runs: [] as RunView[],
  estimate: { count: 0, bytes: 0 },
}));

const { listRuns, estimateReceipts } = vi.hoisted(() => ({
  listRuns: vi.fn(),
  estimateReceipts: vi.fn(),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "cloudBackup" | "userSettings") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/settings/backup",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/security/actor", () => ({
  getCurrentUser: async () => ({
    userId: "u1",
    name: "Ada",
    email: "ada@example.com",
  }),
}));
vi.mock("@/modules/backup/view", () => ({
  loadBackupScreen: async () => state.screen,
}));
vi.mock("@/modules/backup/service", () => ({ listRuns }));
vi.mock("@/modules/backup/receipts", () => ({ estimateReceipts }));
vi.mock("@/modules/backup/actions", () => ({
  updateDestinationAction: vi.fn(),
  runBackupNowAction: vi.fn(),
  removeDestinationAction: vi.fn(),
  estimateReceiptsAction: vi.fn(),
}));

const { default: BackupSettingsPage } = await import("./page");

function backupScreen(overrides: Partial<BackupScreen> = {}): BackupScreen {
  return {
    available: true,
    key: { fingerprint: "9f3a07c2", createdAt: new Date("2026-09-01") },
    destinations: [destination()],
    pendingSetup: null,
    canAddDestination: false,
    providers: [],
    ownedGroups: [
      {
        id: "g1",
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

async function renderPage(query: Record<string, string> = {}) {
  const page = (await BackupSettingsPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(query),
  })) as ReactElement;
  return renderWithIntl(page, { area: "backup" });
}

beforeEach(() => {
  state.screen = backupScreen();
  state.runs = [run()];
  listRuns.mockReset().mockImplementation(async () => state.runs);
  estimateReceipts.mockReset().mockResolvedValue({ count: 0, bytes: 0 });
});

describe("when the server cannot run backups", () => {
  it("says so instead of offering a setup that cannot finish", async () => {
    state.screen = backupScreen({ available: false, destinations: [] });

    await renderPage();

    expect(
      screen.getByText("Cloud backup is not installed on this server"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Cloud backup is not installed on this server. Ask your administrator.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Set up cloud backup" }),
    ).toBeNull();
  });
});

describe("before anything is set up", () => {
  beforeEach(() => {
    state.screen = backupScreen({ destinations: [], key: null });
  });

  it("starts at the recovery key for someone who has none", async () => {
    await renderPage();

    expect(
      screen.getByRole("link", { name: "Set up cloud backup" }),
    ).toHaveAttribute("href", "/settings/backup/setup?step=key");
  });

  it("starts at where to back up for someone who already has one", async () => {
    state.screen = backupScreen({ destinations: [] });

    await renderPage();

    expect(
      screen.getByRole("link", { name: "Set up cloud backup" }),
    ).toHaveAttribute("href", "/settings/backup/setup?step=where");
  });

  it("switches the button off for someone who owns no group", async () => {
    state.screen = backupScreen({ destinations: [], ownedGroups: [] });

    await renderPage();

    expect(
      screen.getByRole("button", { name: "Set up cloud backup" }),
    ).toBeDisabled();
    expect(
      screen.getByText(
        "You don't own a group yet. Only a group's owner can back it up.",
      ),
    ).toBeInTheDocument();
  });

  it("goes back to Settings from the header", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { level: 1, name: "Cloud backup" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to settings" }),
    ).toHaveAttribute("href", "/settings");
  });
});

describe("with a destination", () => {
  it("reads the last ten runs of each and hands them to History", async () => {
    state.runs = [
      run({ id: "r2", status: "failed", errorCode: "quota" }),
      run({ id: "r1" }),
    ];

    await renderPage();

    expect(listRuns).toHaveBeenCalledWith("u1", "d1", { limit: 10 });
    const history = screen.getByRole("heading", { name: "History" });
    expect(history).toBeInTheDocument();
    expect(
      screen.getByText("Not enough space in your Google Drive."),
    ).toBeInTheDocument();
  });

  it("draws each destination as its own set of cards", async () => {
    state.screen = backupScreen({
      destinations: [
        destination(),
        destination({
          id: "d2",
          label: "Dropbox · ada@example.com",
          provider: "dropbox",
        }),
      ],
    });

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Google Drive" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Dropbox" }),
    ).toBeInTheDocument();
    expect(listRuns).toHaveBeenCalledTimes(2);
  });

  it("says how many receipts are left from the last run, and counts none itself", async () => {
    const last = run({ receiptsPending: 140 });
    state.screen = backupScreen({
      destinations: [
        destination({
          includeReceipts: true,
          excludedGroupIds: ["g9"],
          latestRun: last,
          latestSuccess: last,
        }),
      ],
    });

    await renderPage();

    expect(screen.getByText("140 receipts still to go")).toBeInTheDocument();
    // What has gone up is not stored, so the page does not work it out.
    expect(estimateReceipts).not.toHaveBeenCalled();
  });

  it("never counts receipts, whether they are on or not", async () => {
    await renderPage();

    expect(estimateReceipts).not.toHaveBeenCalled();
  });

  it("lists the groups the person owns in Manage, and no others", async () => {
    state.screen = backupScreen({
      ownedGroups: [
        {
          id: "g1",
          name: "Flat",
          participantCount: 2,
          archived: false,
          lastActivityAt: null,
        },
        {
          id: "g2",
          name: "Ski week",
          participantCount: 5,
          archived: false,
          lastActivityAt: null,
        },
      ],
    });
    await renderPage();

    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Manage" }));

    // Each with how many are in it, which tells two groups of one name apart.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("2 members")).toBeInTheDocument();
    expect(screen.getByText("5 members")).toBeInTheDocument();
  });
});

describe("what an OAuth return leaves in the address", () => {
  it("says nothing after a reconnect that worked", async () => {
    await renderPage({ reconnected: "1" });

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says access was not allowed, naming the provider", async () => {
    await renderPage({ connect: "denied" });

    const alert = screen.getByRole("alert");
    expect(
      within(alert).getByText("Access wasn't allowed"),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText(
        "Google Drive did not give Balancia access, so nothing is connected. You can try again.",
      ),
    ).toBeInTheDocument();
  });

  it("words a backup error code the way a failed run is worded", async () => {
    await renderPage({ connect: "quota" });

    expect(
      within(screen.getByRole("alert")).getByText(
        "Not enough space in your Google Drive. Free some space or choose a bigger plan, then back up again.",
      ),
    ).toBeInTheDocument();
  });

  it.each(["failed", "expired"])(
    "reads %s as something going wrong",
    async (outcome) => {
      await renderPage({ connect: outcome });

      expect(
        within(screen.getByRole("alert")).getByText("Something went wrong."),
      ).toBeInTheDocument();
    },
  );

  it("ignores a value nothing sent", async () => {
    await renderPage({ connect: "<b>hello</b>" });

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
