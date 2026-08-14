import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { PositionCard, type PositionView } from "./position-card";
import type { RemindRecipient } from "@/modules/reminders/types";

/**
 * The position card is the point of the screen, so what it must never do is
 * mislead: no zero dressed up as a balance, no direction carried by colour
 * alone, and no way to ask for money you are not owed.
 */

function position(overrides: Partial<PositionView> = {}): PositionView {
  return {
    currency: "EUR",
    minorUnits: "24800",
    counterparties: [
      { name: "Padi", minorUnits: "14800" },
      { name: "Jonas", minorUnits: "10000" },
    ],
    ...overrides,
  };
}

function recipient(overrides: Partial<RemindRecipient> = {}): RemindRecipient {
  return {
    participantId: "p1",
    name: "Jonas",
    debts: [{ amount: "10000", currency: "EUR" }],
    channel: "push",
    lastRemindedAt: null,
    locked: false,
    muted: false,
    ...overrides,
  };
}

function render(props: Partial<Parameters<typeof PositionCard>[0]> = {}) {
  return renderWithIntl(
    <PositionCard
      positions={[position()]}
      groupId="g1"
      groupName="Portugal, March"
      senderName="Seb"
      recipients={[recipient()]}
      {...props}
    />,
  );
}

describe("being owed", () => {
  it("leads with the figure and names who it is coming from", () => {
    render();

    expect(screen.getByText("€248.00")).toBeInTheDocument();
    expect(screen.getByText("You get back")).toBeInTheDocument();
    expect(screen.getByText("from Padi and Jonas")).toBeInTheDocument();
  });

  it("offers both settling and asking", () => {
    render();

    expect(screen.getByRole("link", { name: /settle up/i })).toHaveAttribute(
      "href",
      "/groups/g1/balances",
    );
    expect(screen.getByRole("button", { name: /remind/i })).toBeEnabled();
  });
});

describe("owing", () => {
  it("turns the wording and the direction around", () => {
    render({ positions: [position({ minorUnits: "-14800" })] });

    expect(screen.getByText("€148.00")).toBeInTheDocument();
    expect(screen.getByText("You owe")).toBeInTheDocument();
    expect(screen.getByText("to Padi and Jonas")).toBeInTheDocument();
  });

  /** Reminding on your own debt would be asking yourself for money. */
  it("has nobody to remind", () => {
    render({
      positions: [position({ minorUnits: "-14800" })],
      recipients: [],
    });

    expect(screen.queryByRole("button", { name: /remind/i })).toBeNull();
  });
});

describe("being square", () => {
  it("says so in words rather than showing a zero", () => {
    render({ positions: [position({ minorUnits: "0", counterparties: [] })] });

    expect(screen.getByText("You're settled up")).toBeInTheDocument();
    expect(screen.queryByText(/0\.00/)).toBeNull();
  });

  it("drops both actions, because there is nothing to do", () => {
    render({ positions: [position({ minorUnits: "0", counterparties: [] })] });

    expect(screen.queryByRole("link", { name: /settle up/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remind/i })).toBeNull();
  });

  it("treats a group with no expenses at all the same way", () => {
    render({ positions: [], recipients: [] });

    expect(screen.getByText("You're settled up")).toBeInTheDocument();
  });
});

describe("once everyone has been reminded", () => {
  it("becomes a statement instead of an action", () => {
    render({
      recipients: [
        recipient({ locked: true, lastRemindedAt: "2026-08-14T09:00:00.000Z" }),
      ],
    });

    const button = screen.getByRole("button", { name: /reminded/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-disabled", "true");
  });
});

describe("more than one currency", () => {
  /**
   * Two currencies have no single direction between them, so the heading steps
   * back and each row says which way it goes — in words, not just in colour.
   */
  it("spells out the direction on every row", () => {
    render({
      positions: [
        position({ minorUnits: "24800", counterparties: [] }),
        position({ currency: "CHF", minorUnits: "-5000", counterparties: [] }),
      ],
    });

    expect(screen.getByText("Where you stand")).toBeInTheDocument();
    expect(screen.getByText("You get back")).toBeVisible();
    expect(screen.getByText("You owe")).toBeVisible();
  });

  it("never adds them together", () => {
    render({
      positions: [
        position({ minorUnits: "24800", counterparties: [] }),
        position({ currency: "CHF", minorUnits: "-5000", counterparties: [] }),
      ],
    });

    expect(screen.getByText("€248.00")).toBeInTheDocument();
    expect(screen.getByText("CHF 50.00")).toBeInTheDocument();
  });
});
