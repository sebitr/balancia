import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { RemindButton } from "./remind-button";
import type { RemindRecipient } from "@/modules/reminders/types";

const NOW = "2026-11-24T12:00:00.000Z";

function recipient(overrides: Partial<RemindRecipient> = {}): RemindRecipient {
  return {
    participantId: "katherine",
    name: "Katherine",
    debts: [{ amount: "14800", currency: "EUR" }],
    channel: "push",
    payWith: [],
    lastRemindedAt: null,
    locked: false,
    muted: false,
    link: { kind: "group" },
    ...overrides,
  };
}

function render(
  recipients: RemindRecipient[],
  props: Partial<Parameters<typeof RemindButton>[0]> = {},
  locale: "en" | "fr" | "de" = "en",
) {
  return renderWithIntl(
    <RemindButton
      groupId="g1"
      groupName="Portugal"
      senderName="Seb"
      recipients={recipients}
      now={NOW}
      {...props}
    />,
    { locale },
  );
}

describe("RemindButton", () => {
  it("is an action while somebody can still be reminded", () => {
    render([recipient()]);
    expect(screen.getByRole("button", { name: "Remind" })).toBeEnabled();
  });

  it("says who was reminded and when, as text, once everyone is locked", () => {
    render([
      recipient({
        locked: true,
        lastRemindedAt: "2026-11-24T09:00:00.000Z",
      }),
    ]);
    const button = screen.getByRole("button", {
      name: /Reminded Katherine · 3 hours ago/,
    });
    expect(button).toBeDisabled();
  });

  it("counts people when several were reminded, using the latest time", () => {
    render([
      recipient({ locked: true, lastRemindedAt: "2026-11-23T20:00:00.000Z" }),
      recipient({
        participantId: "jonas",
        name: "Jonas",
        locked: true,
        lastRemindedAt: "2026-11-24T10:00:00.000Z",
      }),
    ]);
    expect(
      screen.getByRole("button", { name: /Reminded 2 people · 2 hours ago/ }),
    ).toBeDisabled();
  });

  it("drops the name where the row above already gives it", () => {
    render(
      [recipient({ locked: true, lastRemindedAt: "2026-11-24T09:00:00.000Z" })],
      { showNames: false },
    );
    expect(
      screen.getByRole("button", { name: "Reminded 3 hours ago" }),
    ).toBeDisabled();
  });

  it("stays pressable while one of several is not locked", () => {
    render(
      [
        recipient({ locked: true, lastRemindedAt: "2026-11-24T09:00:00.000Z" }),
        recipient({ participantId: "jonas", name: "Jonas" }),
      ],
      { label: "Remind all" },
    );
    expect(screen.getByRole("button", { name: "Remind all" })).toBeEnabled();
  });

  it("speaks French and German", () => {
    const locked = [
      recipient({ locked: true, lastRemindedAt: "2026-11-24T09:00:00.000Z" }),
    ];
    const fr = render(locked, {}, "fr");
    expect(screen.getByRole("button").textContent).toContain(
      "Relance envoyée à Katherine",
    );
    fr.unmount();
    render(locked, {}, "de");
    expect(screen.getByRole("button").textContent).toContain(
      "Erinnert: Katherine",
    );
  });
});
