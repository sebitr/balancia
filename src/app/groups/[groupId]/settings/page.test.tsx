import type { ReactElement, ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../../../messages/en.json";
import { renderWithIntl } from "../../../../../tests/helpers/intl";
import type { GroupAccess } from "@/lib/security/authorization";

/**
 * The shortcuts on a group's settings: the screens this one is the way to.
 *
 * Activity is one of them, for everyone who can open settings at all — the
 * Activity screen asks for no more than that, and a Restore on it is still
 * offered only to whoever may press it. Import stays the owner's.
 *
 * The page is a Server Component, called here and its output mounted. The
 * cards above and below the shortcuts are stand-ins with suites of their own.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "settingsPage" | "groupSettings") =>
    createTranslator({ locale: "en", messages: en, namespace }),
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

const { requireGroupAccess } = vi.hoisted(() => ({
  requireGroupAccess: vi.fn<() => Promise<GroupAccess>>(),
}));

vi.mock("@/lib/actions", () => ({ requireGroupAccess }));
vi.mock("@/lib/security/join-link", () => ({
  describeJoinLink: async () => null,
}));
vi.mock("@/modules/groups/service", () => ({
  getGroupProfile: async () => ({
    name: "Lisbon, March",
    description: null,
    icon: null,
    iconColor: null,
  }),
  countUnclaimedParticipants: async () => 0,
}));

vi.mock("@/components/groups/group-settings-form", () => ({
  GroupSettingsForm: () => null,
}));
vi.mock("@/components/groups/currency-mode-note", () => ({
  CurrencyModeNote: () => null,
}));
vi.mock("@/components/groups/invite-link-card", () => ({
  InviteLinkCard: () => null,
}));
vi.mock("@/components/groups/export-card", () => ({ ExportCard: () => null }));
vi.mock("@/components/groups/danger-zone", () => ({ DangerZone: () => null }));

const { default: GroupSettingsPage } = await import("./page");

const NOTHING = {
  manageGroupSettings: false,
  manageInvitations: false,
  importData: false,
  exportData: false,
};

const EVERYTHING = {
  manageGroupSettings: true,
  manageInvitations: true,
  importData: true,
  exportData: true,
};

function access(
  role: GroupAccess["role"],
  permissions: Record<string, boolean>,
): GroupAccess {
  return {
    groupId: "g1",
    actor: { kind: "user", userId: "u1", name: "Ada" },
    participantId: "p-ada",
    role,
    permissions,
    group: {
      id: "g1",
      name: "Lisbon, March",
      currencyMode: "separate",
      baseCurrency: "EUR",
      timezone: "Europe/Lisbon",
      archivedAt: null,
    },
  } as unknown as GroupAccess;
}

async function renderSettings() {
  const page = (await GroupSettingsPage({
    params: Promise.resolve({ groupId: "g1" }),
  } as PageProps<"/groups/[groupId]/settings">)) as ReactElement;
  return renderWithIntl(page);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the settings shortcut to a group's history", () => {
  it("opens the Activity screen for a member who owns nothing here", async () => {
    requireGroupAccess.mockResolvedValue(access("member", NOTHING));

    await renderSettings();

    const row = screen.getByRole("link", { name: "Activity" });
    expect(row).toHaveAttribute("href", "/groups/g1/activity");
    expect(row).toHaveAttribute("data-transition", "push");
    expect(screen.queryByRole("link", { name: "Import data" })).toBeNull();
  });

  it("is offered to a guest as well", async () => {
    requireGroupAccess.mockResolvedValue(access("guest", NOTHING));

    await renderSettings();

    expect(screen.getByRole("link", { name: "Activity" })).toHaveAttribute(
      "href",
      "/groups/g1/activity",
    );
  });

  it("sits between the recurring expenses and the import", async () => {
    requireGroupAccess.mockResolvedValue(access("owner", EVERYTHING));

    await renderSettings();

    const shortcuts = screen
      .getByRole("link", { name: "Activity" })
      .closest("ul")!;
    expect(
      within(shortcuts)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Recurring expenses", "Activity", "Import data"]);
  });
});
