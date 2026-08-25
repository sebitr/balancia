import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import type { SpendingPeriodView } from "./spending-card";

/**
 * The statistics row at the foot of the spending card.
 *
 * Its title and caption used to be one line joined by a middot, and are now
 * stacked. Stacking is a visual separator only: jsdom — and a screen reader —
 * concatenates the two spans into "StatisticsPer person and per category"
 * unless the link states its own name, so that name is what these assert on.
 */

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

const { SpendingCard } = await import("./spending-card");

const THIS_MONTH: SpendingPeriodView = {
  key: "thisMonth",
  stats: [
    {
      currency: "CHF",
      groupSpent: "115900",
      youPaid: "36400",
      yourShare: "38634",
    },
  ],
};

describe("the spending card's statistics row", () => {
  it("names itself with both lines, not with them run together", () => {
    renderWithIntl(
      <SpendingCard groupId="g1" periods={[THIS_MONTH]} compact={false} />,
    );

    expect(
      screen.getByRole("link", {
        name: "Statistics · Per person and per category",
      }),
    ).toHaveAttribute("href", "/groups/g1/stats");
  });

  it("carries the caption in French too", () => {
    renderWithIntl(
      <SpendingCard groupId="g1" periods={[THIS_MONTH]} compact={false} />,
      { locale: "fr" },
    );

    expect(
      screen.getByRole("link", {
        name: "Statistiques · Par personne et par catégorie",
      }),
    ).toBeInTheDocument();
  });

  it("states the reader's share as a share, not as a bare percentage", () => {
    renderWithIntl(
      <SpendingCard groupId="g1" periods={[THIS_MONTH]} compact={false} />,
      { locale: "fr" },
    );

    // 386.34 of 1159.00 is 33%.
    expect(screen.getByText("Ta part : 33 %")).toBeInTheDocument();
  });
});
