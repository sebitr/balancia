import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { formatToday, HomeTitle } from "./home-title";

/**
 * Home's title row: a screen reader's title on a phone, the desktop board's
 * "Your groups · Wednesday 12 August · 4 active groups" with New group from
 * `lg`. jsdom runs no media queries, so both drawings are in the document;
 * what is held is the words and the classes each width is given.
 */

/** The board's Wednesday, at ten in the morning in Lisbon. */
const WEDNESDAY = new Date("2026-08-12T09:00:00Z");

describe("formatToday", () => {
  it("writes the day out in the reader's language and notation", () => {
    expect(
      formatToday(WEDNESDAY, { formatLocale: "en-GB", timeZone: "UTC" }),
    ).toBe("Wednesday 12 August");
    expect(
      formatToday(WEDNESDAY, { formatLocale: "en-US", timeZone: "UTC" }),
    ).toBe("Wednesday, August 12");
    expect(
      formatToday(WEDNESDAY, { formatLocale: "fr", timeZone: "UTC" }),
    ).toBe("mercredi 12 août");
  });

  /** Half past midnight in Paris is still Tuesday in UTC. */
  it("finds the day in the zone the rest of the screen uses", () => {
    const night = new Date("2026-08-11T22:30:00Z");

    expect(formatToday(night, { formatLocale: "en-GB", timeZone: "UTC" })).toBe(
      "Tuesday 11 August",
    );
    expect(
      formatToday(night, { formatLocale: "en-GB", timeZone: "Europe/Paris" }),
    ).toBe("Wednesday 12 August");
  });
});

describe("HomeTitle", () => {
  it("names the screen once, for a screen reader on a phone and drawn from lg", () => {
    renderWithIntl(<HomeTitle today="Wednesday 12 August" open={4} />);

    const title = screen.getByRole("heading", {
      level: 1,
      name: "Your groups",
    });
    expect(title).toHaveClass("sr-only", "lg:not-sr-only");
  });

  it("says the day and how many groups are open under it", () => {
    renderWithIntl(<HomeTitle today="Wednesday 12 August" open={4} />);

    const line = screen.getByText("Wednesday 12 August · 4 active groups");
    expect(line).toHaveClass("hidden", "lg:block");
  });

  it("counts one group as one", () => {
    renderWithIntl(<HomeTitle today="Wednesday 12 August" open={1} />);

    expect(
      screen.getByText("Wednesday 12 August · 1 active group"),
    ).toBeInTheDocument();
  });

  /** Everything settled: the date alone, never "0 active groups". */
  it("leaves the count out when nothing is open", () => {
    renderWithIntl(<HomeTitle today="Wednesday 12 August" open={0} />);

    expect(screen.getByText("Wednesday 12 August")).toBeInTheDocument();
    expect(screen.queryByText(/active group/)).not.toBeInTheDocument();
  });

  it("offers New group at the right from lg, into the sheet on this page", () => {
    renderWithIntl(<HomeTitle today="Wednesday 12 August" open={4} />);

    const create = screen.getByRole("link", { name: "New group" });
    expect(create).toHaveAttribute("href", "?new");
    expect(create).toHaveClass("hidden", "lg:inline-flex");
    expect(create).toHaveAttribute("data-variant", "outline");
  });

  it("reads in French", () => {
    renderWithIntl(<HomeTitle today="mercredi 12 août" open={4} />, {
      locale: "fr",
    });

    expect(
      screen.getByRole("heading", { level: 1, name: "Tes groupes" }),
    ).toBeInTheDocument();
    const line = screen.getByText("mercredi 12 août · 4 groupes actifs");
    // The capital comes from the line's style, where the weekday opens it.
    expect(line).toHaveClass("first-letter:uppercase");
  });
});
