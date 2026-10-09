import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../messages/en.json";
import type { ProviderTile } from "@/modules/backup/view";
import { BackupProvidersCard } from "./providers-card";

/**
 * Administration → which services this server offers.
 *
 * Read from the server's configuration and drawn as statements: each provider
 * is "Ready" (and, for an account provider, whose app) or "Off", as an icon and
 * a word, and nothing on the card can be switched, because the settings are
 * environment variables a screen cannot write.
 */

const { tiles } = vi.hoisted(() => ({
  tiles: { current: [] as ProviderTile[] },
}));

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "cloudBackup") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("@/modules/backup/view", () => ({
  providerTiles: () => tiles.current,
}));

function tile(
  id: ProviderTile["id"],
  availability: ProviderTile["availability"],
  instanceApp = false,
): ProviderTile {
  return {
    id,
    availability,
    kind: ["google_drive", "dropbox", "onedrive"].includes(id)
      ? "oauth"
      : "credentials",
    experimental: id === "proton_drive",
    instanceApp,
    redirectUri: null,
  };
}

/** A fully configured instance: every app registered, experimental on. */
function everythingOn(): ProviderTile[] {
  return [
    tile("google_drive", "available", true),
    tile("dropbox", "available", true),
    tile("onedrive", "available", true),
    tile("s3", "available"),
    tile("webdav", "available"),
    tile("proton_drive", "available"),
  ];
}

async function renderCard() {
  return render(await BackupProvidersCard());
}

/** The state beside a provider's name. */
function stateOf(name: string): string {
  const row = screen.getByText(name).closest("li") as HTMLElement;
  return row.querySelector('[data-slot="admin-state"]')?.textContent ?? "";
}

beforeEach(() => {
  tiles.current = everythingOn();
});

describe("the providers card", () => {
  it("names its three groups", async () => {
    await renderCard();

    expect(screen.getByText("Cloud backup providers")).toBeInTheDocument();
    expect(
      screen.getByText("Which services people on this server can back up to."),
    ).toBeInTheDocument();
    for (const label of [
      "Sign in with an account",
      "Own server or storage",
      "Experimental",
    ]) {
      expect(screen.getByRole("heading", { name: label })).toBeInTheDocument();
    }
  });

  it("says Ready for everything on a fully configured instance", async () => {
    await renderCard();

    for (const name of [
      "S3-compatible",
      "Nextcloud or other WebDAV",
      "Infomaniak",
      "Proton Drive",
    ]) {
      expect(stateOf(name)).toBe("Ready");
    }
    for (const name of ["Google Drive", "Dropbox", "Microsoft OneDrive"]) {
      expect(stateOf(name)).toBe("Ready · everyone connects with one button");
    }
    expect(screen.queryByText(/Turn on with/)).toBeNull();
    expect(screen.queryByText(/For one button/)).toBeNull();
  });

  it("says which account provider has no app of the server's own, and only that one", async () => {
    tiles.current = [
      tile("google_drive", "available"),
      tile("dropbox", "available", true),
      tile("onedrive", "available"),
      tile("s3", "available"),
      tile("webdav", "available"),
      tile("proton_drive", "experimental_off"),
    ];

    await renderCard();

    // Not a fault and not "off": people bring their own app, and it works.
    expect(stateOf("Google Drive")).toBe(
      "Ready · each person brings their own app",
    );
    expect(stateOf("Dropbox")).toBe(
      "Ready · everyone connects with one button",
    );
    expect(stateOf("Microsoft OneDrive")).toBe(
      "Ready · each person brings their own app",
    );
  });

  it("names the settings that would give a provider its one button, only where it lacks one", async () => {
    tiles.current = [
      tile("google_drive", "available"),
      tile("dropbox", "available", true),
      tile("onedrive", "available"),
    ];

    await renderCard();

    expect(
      screen.getByText(
        "For one button, set BACKUP_GOOGLE_CLIENT_ID and BACKUP_GOOGLE_CLIENT_SECRET.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "For one button, set BACKUP_MICROSOFT_CLIENT_ID and BACKUP_MICROSOFT_CLIENT_SECRET.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/BACKUP_DROPBOX/)).toBeNull();
  });

  it("keeps the own-server group ready whatever is registered", async () => {
    tiles.current = [
      tile("google_drive", "available"),
      tile("dropbox", "available"),
      tile("onedrive", "available"),
      tile("proton_drive", "experimental_off"),
    ];

    await renderCard();

    for (const name of [
      "S3-compatible",
      "Nextcloud or other WebDAV",
      "Infomaniak",
    ]) {
      expect(stateOf(name)).toBe("Ready");
    }
  });

  it("says Proton Drive is off, and which variable turns it on", async () => {
    tiles.current = tiles.current.map((entry) =>
      entry.id === "proton_drive"
        ? tile("proton_drive", "experimental_off")
        : entry,
    );

    await renderCard();

    expect(stateOf("Proton Drive")).toBe("Off");
    expect(
      screen.getByText("Turn on with BACKUP_EXPERIMENTAL_PROVIDERS."),
    ).toBeInTheDocument();
  });

  it("calls Proton Drive experimental on its own row, in words", async () => {
    await renderCard();

    const row = screen.getByText("Proton Drive").closest("li") as HTMLElement;
    expect(row).toHaveTextContent("Experimental");
  });

  it("draws every state as an icon and a word", async () => {
    tiles.current = [
      tile("google_drive", "available"),
      tile("dropbox", "available", true),
      tile("s3", "available"),
      tile("proton_drive", "experimental_off"),
    ];

    await renderCard();

    for (const word of [
      "Ready",
      "Ready · each person brings their own app",
      "Ready · everyone connects with one button",
      "Off",
    ]) {
      const marks = screen.getAllByText(word, {
        selector: "[data-slot=admin-state]",
      });
      for (const mark of marks) {
        expect(mark.querySelector("svg")).toHaveAttribute(
          "aria-hidden",
          "true",
        );
      }
    }
  });

  it("has nothing to switch", async () => {
    await renderCard();

    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
