import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { BackupEmptyState } from "./empty-state";

/**
 * `/settings/backup` before anything is set up.
 *
 * Two variants: the person who owns a group, who is offered the way in, and the
 * one who does not, who is told why there is nothing to set up rather than shown
 * a button that does nothing.
 */

function renderEmpty(props: { startHref?: string; ownsGroups?: boolean } = {}) {
  return renderWithIntl(
    <BackupEmptyState
      startHref={props.startHref ?? "/settings/backup/setup?step=key"}
      ownsGroups={props.ownsGroups ?? true}
    />,
    { area: "backup" },
  );
}

describe("for someone who owns a group", () => {
  it("says what it does and why it is safe, in three reasons", () => {
    renderEmpty();

    expect(
      screen.getByRole("heading", { name: "Back up your groups to the cloud" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/encrypted before it leaves this server/),
    ).toBeInTheDocument();
    expect(screen.getByText("Locked on this server")).toBeInTheDocument();
    expect(
      screen.getByText("Opened only with your recovery key"),
    ).toBeInTheDocument();
    expect(screen.getByText("Stored as unreadable files")).toBeInTheDocument();
  });

  it("offers the way in, to the first step it was given", () => {
    renderEmpty({ startHref: "/settings/backup/setup?step=where" });

    expect(
      screen.getByRole("link", { name: "Set up cloud backup" }),
    ).toHaveAttribute("href", "/settings/backup/setup?step=where");
    expect(screen.queryByText(/don't own a group/)).toBeNull();
  });

  it("offers a way to open a file instead, for someone with no destination", () => {
    renderEmpty();

    expect(
      screen.getByRole("link", {
        name: "Have a backup file? Restore from a backup",
      }),
    ).toHaveAttribute("href", "/settings/backup/restore");
  });
});

describe("for someone who owns no group", () => {
  it("switches the button off and says why", () => {
    renderEmpty({ ownsGroups: false });

    const start = screen.getByRole("button", { name: "Set up cloud backup" });
    expect(start).toBeDisabled();
    expect(start).toHaveAccessibleDescription(
      "You don't own a group yet. Only a group's owner can back it up.",
    );
    expect(
      screen.queryByRole("link", { name: "Set up cloud backup" }),
    ).toBeNull();
  });

  it("still lets them open a file they were given", () => {
    renderEmpty({ ownsGroups: false });

    expect(
      screen.getByRole("link", { name: /Restore from a backup/ }),
    ).toBeInTheDocument();
  });
});
