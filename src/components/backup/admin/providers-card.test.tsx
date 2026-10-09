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
 * is "Ready", "Needs a client ID and secret" or "Off", as an icon and a word,
 * and nothing on the card can be switched, because the settings are environment
 * variables a screen cannot write.
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
): ProviderTile {
  return {
    id,
    availability,
    kind: ["google_drive", "dropbox", "onedrive"].includes(id)
      ? "oauth"
      : "credentials",
    experimental: id === "proton_drive",
  };
}

/** A fully configured instance: every app registered, experimental on. */
function everythingOn(): ProviderTile[] {
  return [
    tile("google_drive", "available"),
    tile("dropbox", "available"),
    tile("onedrive", "available"),
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
      "Google Drive",
      "Dropbox",
      "Microsoft OneDrive",
      "S3-compatible",
      "Nextcloud or other WebDAV",
      "Infomaniak",
      "Proton Drive",
    ]) {
      expect(stateOf(name)).toBe("Ready");
    }
    expect(screen.queryByText(/Turn on with/)).toBeNull();
  });

  it("says which account provider has no app registered, and only that one", async () => {
    tiles.current = [
      tile("google_drive", "needs_operator"),
      tile("dropbox", "available"),
      tile("onedrive", "needs_operator"),
      tile("s3", "available"),
      tile("webdav", "available"),
      tile("proton_drive", "experimental_off"),
    ];

    await renderCard();

    expect(stateOf("Google Drive")).toBe("Needs a client ID and secret");
    expect(stateOf("Dropbox")).toBe("Ready");
    expect(stateOf("Microsoft OneDrive")).toBe("Needs a client ID and secret");
  });

  it("keeps the own-server group ready whatever is registered", async () => {
    tiles.current = [
      tile("google_drive", "needs_operator"),
      tile("dropbox", "needs_operator"),
      tile("onedrive", "needs_operator"),
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
      tile("google_drive", "needs_operator"),
      tile("dropbox", "available"),
      tile("proton_drive", "experimental_off"),
    ];

    await renderCard();

    for (const word of ["Ready", "Needs a client ID and secret", "Off"]) {
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
