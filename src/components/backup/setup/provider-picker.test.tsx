import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ProviderChoice } from "@/components/backup/provider-mark";
import type { ProviderTile } from "@/modules/backup/view";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { TILES } from "../../../../tests/helpers/setup-wizard";
import { pickerOptions, ProviderPicker } from "./provider-picker";

/**
 * Choosing where the backups go.
 *
 * The things worth holding in place: one row is chosen at a time, a provider
 * this server does not offer cannot be chosen and says why in words, and
 * Infomaniak — which is not a provider at all — is there exactly when the two
 * it stands for are.
 */

function tiles(
  changes: Partial<Record<ProviderTile["id"], ProviderTile["availability"]>>,
): ProviderTile[] {
  return TILES.map((tile) => ({
    ...tile,
    availability: changes[tile.id] ?? tile.availability,
  }));
}

function renderPicker(
  providers: readonly ProviderTile[] = TILES,
  initial: ProviderChoice | null = null,
) {
  const onSelect = vi.fn();
  function Picker() {
    const [selected, setSelected] = useState(initial);
    return (
      <ProviderPicker
        providers={providers}
        selected={selected}
        onSelect={(choice) => {
          onSelect(choice);
          setSelected(choice);
        }}
      />
    );
  }
  return { ...renderWithIntl(<Picker />), onSelect, user: userEvent.setup() };
}

const radio = (name: string | RegExp) => screen.getByRole("radio", { name });

describe("ProviderPicker", () => {
  it("draws the three groups, and the experimental one only when there is a provider in it", () => {
    renderPicker();

    expect(screen.getByText("Sign in with your account")).toBeInTheDocument();
    expect(
      screen.getByText("Use your own server or storage"),
    ).toBeInTheDocument();
    expect(screen.getByText("Experimental")).toBeInTheDocument();
  });

  it("leaves out a group with nothing in it", () => {
    renderPicker(TILES.filter((tile) => !tile.experimental));
    expect(screen.queryByText("Experimental")).toBeNull();
  });

  it("lists the providers a server offers, in the order they are drawn", () => {
    renderPicker();

    expect(
      screen.getAllByRole("radio").map((node) => node.textContent),
    ).toEqual([
      expect.stringContaining("Google Drive"),
      expect.stringContaining("Dropbox"),
      expect.stringContaining("Microsoft OneDrive"),
      expect.stringContaining("Infomaniak"),
      expect.stringContaining("Nextcloud or other WebDAV"),
      expect.stringContaining("S3-compatible"),
      expect.stringContaining("Proton Drive"),
    ]);
  });

  it("adds a hint where a provider has a catch", () => {
    renderPicker();

    expect(radio("Microsoft OneDrive")).toHaveAccessibleDescription(
      "Personal Microsoft accounts only",
    );
    expect(radio("Infomaniak")).toHaveAccessibleDescription(
      "kDrive or Swiss Backup",
    );
    expect(radio("S3-compatible")).toHaveAccessibleDescription(
      "AWS, Backblaze B2, Wasabi, Cloudflare R2, MinIO",
    );
  });

  it("chooses one row at a time", async () => {
    const { user, onSelect } = renderPicker();

    await user.click(radio("Google Drive"));
    expect(radio("Google Drive")).toBeChecked();

    await user.click(radio("S3-compatible"));
    expect(radio("S3-compatible")).toBeChecked();
    expect(radio("Google Drive")).not.toBeChecked();
    expect(screen.getAllByRole("radio", { checked: true })).toHaveLength(1);
    expect(onSelect.mock.calls).toEqual([["google_drive"], ["s3"]]);
  });

  it("shows what is already chosen", () => {
    renderPicker(TILES, "dropbox");
    expect(radio("Dropbox")).toBeChecked();
  });

  it("moves with the arrow keys, over the rows it can choose", async () => {
    const { user, onSelect } = renderPicker(
      tiles({ dropbox: "experimental_off" }),
      "google_drive",
    );

    radio("Google Drive").focus();
    await user.keyboard("{ArrowDown}");

    // Dropbox is switched off, so the arrow steps over it.
    expect(onSelect).toHaveBeenLastCalledWith("onedrive");
    expect(radio("Microsoft OneDrive")).toHaveFocus();
  });

  describe("a provider this server has not switched on", () => {
    const switchedOff = tiles({
      onedrive: "experimental_off",
      proton_drive: "experimental_off",
    });

    it("cannot be chosen", async () => {
      const { user, onSelect } = renderPicker(switchedOff);

      expect(radio("Microsoft OneDrive")).toBeDisabled();
      await user.click(radio("Microsoft OneDrive"));

      expect(onSelect).not.toHaveBeenCalled();
      expect(radio("Microsoft OneDrive")).not.toBeChecked();
    });

    it("says so in words, not only by being dim", () => {
      renderPicker(switchedOff);

      const row = radio("Microsoft OneDrive");
      expect(row).toHaveAccessibleDescription(
        "Not enabled on this server Ask your administrator.",
      );
      expect(within(row).getByText("Not enabled on this server")).toBeVisible();
      expect(within(row).getByText("Ask your administrator.")).toBeVisible();
      expect(radio("Proton Drive")).toHaveAccessibleDescription(
        "Not enabled on this server Ask your administrator.",
      );
      // And the hint it would otherwise have is not left beside it.
      expect(
        within(row).queryByText("Personal Microsoft accounts only"),
      ).toBeNull();
    });

    it("leaves the others as they were", async () => {
      const { user } = renderPicker(switchedOff);

      await user.click(radio("Dropbox"));
      expect(radio("Dropbox")).toBeChecked();
      expect(radio("Dropbox")).not.toBeDisabled();
    });
  });

  describe("Infomaniak", () => {
    it("is there when the two services behind it are", () => {
      renderPicker();
      expect(radio("Infomaniak")).not.toBeDisabled();
    });

    it("is there, but off, when one of them is switched off", () => {
      renderPicker(tiles({ webdav: "experimental_off" }));
      expect(radio("Infomaniak")).toBeDisabled();
    });

    it("is not offered when a server has no S3 at all", () => {
      renderPicker(TILES.filter((tile) => tile.id !== "s3"));
      expect(screen.queryByRole("radio", { name: "Infomaniak" })).toBeNull();
    });

    it("can be chosen like the rest", async () => {
      const { user, onSelect } = renderPicker();
      await user.click(radio("Infomaniak"));
      expect(onSelect).toHaveBeenCalledWith("infomaniak");
    });
  });

  describe("the experimental group", () => {
    it("keeps its caution folded until it is asked for", async () => {
      const { user } = renderPicker();

      const toggle = screen.getByRole("button", {
        name: "Read this before you choose",
      });
      expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(
        screen.queryByText(
          "These services offer no official way for an app like Balancia to back up to them.",
        ),
      ).toBeNull();

      await user.click(toggle);

      expect(
        screen.getByText(
          "These services offer no official way for an app like Balancia to back up to them.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "They can stop working whenever the service changes something.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "Balancia has to store your account password on this server.",
        ),
      ).toBeInTheDocument();
    });

    it("offers Proton Drive and nothing else, whatever else the server sends", () => {
      const rows = pickerOptions([
        ...TILES,
        {
          id: "icloud_drive",
          experimental: true,
          availability: "available",
        },
      ]).filter((option) => option.group === "experimental");

      expect(rows.map((row) => row.id)).toEqual(["proton_drive"]);
    });
  });
});
