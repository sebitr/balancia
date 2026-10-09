import type { ComponentProps } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import type { BackupProvider } from "@/modules/backup/providers";
import { BackupOverview } from "./backup-overview";
import { destination, GROUPS, NOW, run } from "./fixtures";

/**
 * The overview as one piece: the banner for each way a destination needs a
 * hand, and the way back into History from it.
 *
 * A revoked connection owns the screen's one filled button, so "Back up now"
 * is switched off until it is reconnected; a run of failures does not, because
 * the connection is fine and a press may well be the thing that mends it.
 */

const { router } = vi.hoisted(() => ({
  router: { push: vi.fn(), refresh: vi.fn() },
}));

vi.mock("@/modules/backup/actions", () => ({
  updateDestinationAction: vi.fn(),
  runBackupNowAction: vi.fn(),
  removeDestinationAction: vi.fn(),
  estimateReceiptsAction: vi.fn(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/settings/backup",
}));

type Props = ComponentProps<typeof BackupOverview>;

function renderOverview(props: Partial<Props> = {}) {
  const base: Props = {
    destination: destination(),
    runs: [run()],
    groups: GROUPS,
    keyFingerprint: "9f3a07c2",
    now: NOW,
  };
  return {
    ...renderWithIntl(<BackupOverview {...base} {...props} />, {
      area: "backup",
    }),
    user: userEvent.setup(),
  };
}

const revoked = (provider: BackupProvider = "google_drive") =>
  destination({
    provider,
    status: "needs_reconnect",
    attention: "reconnect",
    consecutiveFailures: 1,
  });

beforeEach(() => {
  router.push.mockReset();
  router.refresh.mockReset();
});

describe("a healthy destination", () => {
  it("has no banner", () => {
    renderOverview();

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ends in the way to Restore", () => {
    renderOverview();

    const link = screen.getByRole("link", { name: /Restore from a backup/ });
    expect(link).toHaveAttribute("href", "/settings/backup/restore");
    expect(
      screen.getByText("Open a backup file with your recovery key."),
    ).toBeInTheDocument();
  });
});

describe("a revoked connection", () => {
  it("says so, names the provider, and offers to reconnect", () => {
    renderOverview({ destination: revoked("dropbox") });

    const banner = screen.getByRole("alert");
    expect(within(banner).getByText("Reconnect Dropbox")).toBeInTheDocument();
    expect(
      within(banner).getByText("Access was revoked, so backups have stopped."),
    ).toBeInTheDocument();
    expect(
      within(banner).getByRole("link", { name: "Reconnect" }),
    ).toBeInTheDocument();
  });

  it("switches Back up now off until it is reconnected", () => {
    renderOverview({ destination: revoked() });

    expect(screen.getByRole("button", { name: "Back up now" })).toBeDisabled();
  });

  it.each([
    ["google_drive", "/api/backup/oauth/google/start?reconnect=d1"],
    ["dropbox", "/api/backup/oauth/dropbox/start?reconnect=d1"],
    // The route is named for the identity provider, not the product.
    ["onedrive", "/api/backup/oauth/microsoft/start?reconnect=d1"],
  ] as const)(
    "sends %s back through the provider by a plain anchor",
    (provider, href) => {
      renderOverview({ destination: revoked(provider) });

      const link = screen.getByRole("link", { name: "Reconnect" });
      expect(link).toHaveAttribute("href", href);
      // Not a form, not a button, and not a link a router could prefetch: a
      // prefetch of this address would start the flow.
      expect(link.tagName).toBe("A");
    },
  );

  it.each([
    ["s3", "/settings/backup/setup?step=connect&provider=s3&replace=d1"],
    [
      "webdav",
      "/settings/backup/setup?step=connect&provider=webdav&replace=d1",
    ],
    [
      "proton_drive",
      "/settings/backup/setup?step=connect&provider=proton_drive&replace=d1",
    ],
  ] as const)(
    "sends %s back to the connect step, to replace this one",
    (provider, href) => {
      renderOverview({ destination: revoked(provider) });

      expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
        "href",
        href,
      );
    },
  );
});

describe("a connection whose app the provider turned away", () => {
  const refused = (provider: BackupProvider = "google_drive") => ({
    destination: revoked(provider),
    runs: [
      run({
        id: "f1",
        status: "failed",
        groupCount: 0,
        errorCode: "app",
        errorDetail: "invalid_client",
      }),
    ],
  });

  it("says the app is the problem, not that access was taken back", () => {
    renderOverview(refused());

    const banner = screen.getByRole("alert");
    expect(
      within(banner).getByText(
        /Google Drive does not accept the app this connection was made with\./,
      ),
    ).toBeInTheDocument();
    expect(
      within(banner).getByText(/with the right client ID and secret/),
    ).toBeInTheDocument();
    expect(
      within(banner).queryByText(
        "Access was revoked, so backups have stopped.",
      ),
    ).toBeNull();
  });

  it.each([
    ["google_drive", "google_drive"],
    ["dropbox", "dropbox"],
    ["onedrive", "onedrive"],
  ] as const)(
    "sends %s back through the wizard to enter new details, not round the same trip",
    (provider, route) => {
      renderOverview(refused(provider));

      // Reconnecting through the same app would be refused the same way.
      expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
        "href",
        `/settings/backup/setup?step=connect&provider=${route}&replace=d1`,
      );
    },
  );

  it("still sends a plainly revoked connection round the trip it was made through", () => {
    renderOverview({
      destination: revoked("google_drive"),
      runs: [run({ id: "f2", status: "failed", errorCode: "reconnect" })],
    });

    expect(screen.getByRole("link", { name: "Reconnect" })).toHaveAttribute(
      "href",
      "/api/backup/oauth/google/start?reconnect=d1",
    );
  });
});

describe("a run of failures", () => {
  const failing = () => {
    const latest = run({
      id: "f3",
      status: "failed",
      groupCount: 0,
      bytes: 0,
      errorCode: "quota",
      errorDetail: "storageQuotaExceeded",
      startedAt: new Date("2026-10-09T03:30:00.000Z"),
    });
    const earlier = [
      run({
        id: "f2",
        status: "failed",
        errorCode: "quota",
        startedAt: new Date("2026-10-08T03:30:00.000Z"),
      }),
      run({
        id: "f1",
        status: "failed",
        errorCode: "quota",
        startedAt: new Date("2026-10-07T03:30:00.000Z"),
      }),
    ];
    return {
      destination: destination({
        provider: "dropbox",
        label: "Dropbox · ada@example.com",
        consecutiveFailures: 3,
        attention: "failing",
        latestRun: latest,
        latestSuccess: null,
        nextRunAt: new Date("2026-10-09T19:30:00.000Z"),
      }),
      runs: [latest, ...earlier],
    };
  };

  it("counts them, and gives the latest one's sentence and what to do", () => {
    renderOverview(failing());

    const banner = screen.getByRole("alert");
    expect(
      within(banner).getByText("The last 3 backups failed"),
    ).toBeInTheDocument();
    expect(
      within(banner).getByText(
        "Not enough space in your Dropbox. Free some space or choose a bigger plan, then back up again.",
      ),
    ).toBeInTheDocument();
  });

  it("leaves Back up now working, because the connection is fine", () => {
    renderOverview(failing());

    expect(screen.getByRole("button", { name: "Back up now" })).toBeEnabled();
    expect(screen.queryByRole("link", { name: "Reconnect" })).toBeNull();
  });

  it("opens the failed row in History from 'See details'", async () => {
    const { user } = renderOverview(failing());
    const row = screen.getAllByRole("button", { name: /Failed/ })[0];
    expect(row).toHaveAttribute("aria-expanded", "false");

    await user.click(screen.getByRole("button", { name: "See details" }));

    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("What happened")).toBeInTheDocument();
    expect(screen.getByText("storageQuotaExceeded")).toBeInTheDocument();
  });
});
