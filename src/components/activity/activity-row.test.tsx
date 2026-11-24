import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { expectLabelInName } from "../../../tests/helpers/label-in-name";

/**
 * The overview's way into the group's history: named for both of its lines,
 * and showing nothing that name leaves out. Run together, the two stacked
 * lines were a word the name did not have, and axe failed the group overview
 * on it (label-content-name-mismatch, in the Playwright journeys).
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

const { ActivityRow } = await import("./activity-row");

describe("the Activity row", () => {
  it("shows only words its name says", () => {
    renderWithIntl(<ActivityRow groupId="g1" />);

    const link = screen.getByRole("link", { name: /^Activity · / });
    expect(link).toHaveAttribute("href", "/groups/g1/activity");
    expectLabelInName(link, link.getAttribute("aria-label") ?? "");
  });
});
