import { describe, expect, it } from "vitest";
import { screen, within } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import {
  NeedsYouCard,
  OwedCard,
  type NeedsYouView,
  type OwedView,
} from "./group-sections";

/**
 * Weight follows what a group asks of the reader: a debt gets a card with the
 * two things you might do about it, being owed gets a row.
 */

const NOW = "2026-08-13T12:00:00.000Z";

function needsYou(overrides: Partial<NeedsYouView> = {}): NeedsYouView {
  return {
    id: "g1",
    name: "Flatshare",
    icon: null,
    iconColor: null,
    memberNames: ["Sofia", "Mika"],
    participantCount: 2,
    lastActivityAt: "2026-08-11T12:00:00.000Z",
    amounts: [{ minorUnits: "-10000", currency: "EUR" }],
    owedTo: { kind: "single", name: "Mika" },
    ...overrides,
  };
}

function owed(overrides: Partial<OwedView> = {}): OwedView {
  return {
    id: "g2",
    name: "Lisbon, March",
    icon: null,
    iconColor: null,
    participantCount: 4,
    lastActivityAt: "2026-08-13T08:00:00.000Z",
    amounts: [{ minorUnits: "24800", currency: "EUR" }],
    ...overrides,
  };
}

describe("NeedsYouCard", () => {
  it("names a single creditor, and offers both ways out of the debt", () => {
    renderWithIntl(
      <NeedsYouCard group={needsYou()} now={NOW} urgent={false} />,
    );

    expect(screen.getByText("€100.00")).toBeVisible();
    expect(screen.getByText("you owe Mika")).toBeVisible();
    expect(screen.getByRole("link", { name: "Settle up" })).toHaveAttribute(
      "href",
      "/groups/g1/balances",
    );
    expect(screen.getByRole("link", { name: "Add expense" })).toHaveAttribute(
      "href",
      "/groups/g1/expenses/new",
    );
  });

  it("counts creditors instead of naming one when there are several", () => {
    renderWithIntl(
      <NeedsYouCard
        group={needsYou({ owedTo: { kind: "several", count: 3 } })}
        now={NOW}
        urgent={false}
      />,
    );

    expect(screen.getByText("split across 3 people")).toBeVisible();
  });

  it("keeps the direction word for a screen reader, since the label carries it visually", () => {
    renderWithIntl(
      <NeedsYouCard group={needsYou()} now={NOW} urgent={false} />,
    );

    expect(screen.getByText("owes")).toBeInTheDocument();
  });

  it("names the people behind the avatar stack", () => {
    renderWithIntl(
      <NeedsYouCard
        group={needsYou({
          memberNames: ["Sofia", "Jonas", "Mika"],
          participantCount: 6,
        })}
        now={NOW}
        urgent={false}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Sofia, Jonas and 4 others" }),
    ).toBeVisible();
  });

  it("tints only the urgent card, and never as the sole cue", () => {
    const { container: plain } = renderWithIntl(
      <NeedsYouCard group={needsYou()} now={NOW} urgent={false} />,
    );
    const plainRing = plain.firstElementChild?.className ?? "";

    const { container: urgent } = renderWithIntl(
      <NeedsYouCard group={needsYou()} now={NOW} urgent />,
    );
    const urgentRing = urgent.firstElementChild?.className ?? "";

    expect(plainRing).toContain("ring-border");
    expect(urgentRing).toContain("--negative");
    // The amount, its icon and its hidden word are unchanged by urgency.
    expect(screen.getAllByText("€100.00")).toHaveLength(2);
  });
});

describe("OwedCard", () => {
  it("collapses to rows carrying size and last activity, not avatars", () => {
    renderWithIntl(<OwedCard groups={[owed()]} now={NOW} />);

    const row = screen.getByRole("link", { name: /Lisbon, March/ });
    expect(within(row).getByText(/4 people/)).toBeVisible();
    expect(within(row).getByText("4 hours ago")).toBeVisible();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows each group's own currency, not the converted total", () => {
    renderWithIntl(
      <OwedCard
        groups={[owed({ amounts: [{ minorUnits: "21000", currency: "CHF" }] })]}
        now={NOW}
      />,
    );

    expect(screen.getByText("CHF 210.00")).toBeVisible();
  });
});
