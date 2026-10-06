import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { createTranslator } from "use-intl/core";
import en from "../../../messages/en.json";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { ActivityEntry } from "@/modules/activity/service";

/**
 * "Since your last visit": what changed while the reader was away, and the
 * way from there to everything else that did.
 *
 * Rendered on the server; here it is awaited and its output mounted, with the
 * real English catalogue behind it.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "activity" | "group") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));

vi.mock("@/i18n/preferences", () => ({
  getNumberLocale: async () => "en-GB",
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

const { SinceLastOpened } = await import("./since-last-opened");

const LUNCH_ADDED: ActivityEntry = {
  id: "a1",
  action: "expense.created",
  entityType: "expense",
  entityId: "e1",
  metadata: { description: "Lunch" },
  actorLabel: "Bob",
  actorType: "user",
  actorParticipantId: "p-bob",
  createdAt: new Date("2026-09-02T12:00:00Z"),
};

const block = (lastOpenedAt: string | null) =>
  SinceLastOpened({
    entries: [LUNCH_ADDED],
    lastOpenedAt,
    groupId: "g1",
    now: "2026-09-03T00:00:00Z",
  });

describe("since your last visit", () => {
  it("links its heading to the group's whole history", async () => {
    const rendered = await block("2026-09-01T00:00:00Z");
    expect(rendered).not.toBeNull();
    renderWithIntl(rendered!);

    const link = screen.getByRole("link", { name: "View all" });
    expect(link).toHaveAttribute("href", "/groups/g1/activity");
    expect(link).toHaveAttribute("data-transition", "push");
    // Read out of a list of links, it says which "View all" it is.
    expect(link).toHaveAccessibleDescription("Since your last visit");
  });

  it("renders nothing when nothing is new, leaving the way in to the overview's own row", async () => {
    expect(await block("2026-09-02T18:00:00Z")).toBeNull();
  });

  /**
   * "Bob recorded a repayment" beside "Bob added an expense: Lunch" said
   * nothing a reader could use. The event knows who paid whom and how much.
   */
  it("says who paid whom, and how much, calling the reader you", async () => {
    const rendered = await SinceLastOpened({
      entries: [
        {
          ...LUNCH_ADDED,
          id: "a2",
          action: "settlement.created",
          entityType: "settlement",
          entityId: "s1",
          metadata: {
            amount: "3000",
            currency: "EUR",
            from: "p-sam",
            to: "p-marta",
          },
        },
      ],
      lastOpenedAt: "2026-09-01T00:00:00Z",
      groupId: "g1",
      now: "2026-09-03T00:00:00Z",
      people: {
        you: "p-marta",
        names: new Map([
          ["p-sam", "Sam"],
          ["p-marta", "Marta"],
        ]),
      },
    });
    renderWithIntl(rendered!);

    expect(
      screen.getByText("recorded Sam's repayment of €30.00 to you"),
    ).toBeInTheDocument();
  });
});
