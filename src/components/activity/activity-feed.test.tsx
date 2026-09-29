import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "../../../messages/en.json";
import { createDateFormatter } from "@/i18n/format";
import type { ActivityEntry } from "@/modules/activity/service";

/**
 * Whose clock the feed tells the time on.
 *
 * The app's own zone is the server's — UTC unless an operator set `TZ` — and
 * the feed used to read every event on it, so a group in Paris saw 14:05
 * against an expense its members added at 16:05. The formatter below is the
 * server's, UTC and all, which is exactly the situation the feed has to
 * correct for.
 *
 * The feed is an async Server Component, so it is awaited and its output
 * rendered, rather than mounted.
 */

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "activity") =>
    createTranslator({ locale: "en", messages: en, namespace }),
}));
vi.mock("@/i18n/preferences", () => ({
  getDateFormatter: async () =>
    createDateFormatter({
      dateFormat: "dmy",
      formatLocale: "en-GB",
      timeZone: "UTC",
    }),
}));

const { ActivityFeed } = await import("./activity-feed");

const ADDED: ActivityEntry = {
  id: "a1",
  action: "expense.created",
  entityType: "expense",
  entityId: "e1",
  metadata: { description: "Groceries" },
  actorLabel: "Seb",
  actorType: "user",
  // Five past two in the afternoon in UTC; five past four in Paris, which is
  // on summer time in August.
  createdAt: new Date("2026-08-13T14:05:00Z"),
};

describe("ActivityFeed", () => {
  it("tells the time on the group's clock, not the server's", async () => {
    render(await ActivityFeed({ entries: [ADDED], timeZone: "Europe/Paris" }));

    const time = screen.getByText(/16:05/);
    expect(time).toHaveTextContent("13/08/2026, 16:05");
    // The machine-readable instant is still the instant.
    expect(time).toHaveAttribute("datetime", "2026-08-13T14:05:00.000Z");
    expect(screen.queryByText(/14:05/)).not.toBeInTheDocument();
  });

  it("moves the day with the clock", async () => {
    // A quarter to midnight in UTC is already tomorrow in Auckland.
    render(
      await ActivityFeed({
        entries: [{ ...ADDED, createdAt: new Date("2026-08-13T23:45:00Z") }],
        timeZone: "Pacific/Auckland",
      }),
    );

    expect(screen.getByText(/11:45/)).toHaveTextContent("14/08/2026, 11:45");
  });
});
