import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ExportCard } from "./export-card";

/**
 * The export card is also where somebody comes looking for the way back, so
 * what it must not do is offer a restore to a guest who cannot perform one.
 */
describe("ExportCard", () => {
  it("offers all three formats as downloads from this group", () => {
    renderWithIntl(<ExportCard groupId="g1" canImport={false} />);

    for (const format of ["csv", "xlsx", "json"]) {
      expect(
        screen
          .getAllByRole("link")
          .some(
            (link) =>
              link.getAttribute("href") ===
              `/api/groups/g1/export?format=${format}`,
          ),
      ).toBe(true);
    }
  });

  it("points someone who can import at the restore", () => {
    renderWithIntl(<ExportCard groupId="g1" canImport />);

    expect(
      screen.getByRole("link", { name: "Import a backup" }),
    ).toHaveAttribute("href", "/groups/g1/import");
  });

  it("says nothing about restoring to someone who cannot", () => {
    renderWithIntl(<ExportCard groupId="g1" canImport={false} />);

    expect(screen.queryByRole("link", { name: "Import a backup" })).toBeNull();
  });
});
