import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { FormatPreferencesProvider } from "@/i18n/format-context";
import { DEFAULT_DATE_FORMAT, DEFAULT_NUMBER_FORMAT } from "@/i18n/format";
import { Amount } from "./amount";

/**
 * The sign in front of a figure, in the app's own hand.
 *
 * Intl writes a loss as "-CHF 961", an ASCII hyphen flush against the code,
 * and everything the app draws itself writes "− CHF 961". The dashboard once
 * showed both on one screen — the hero in Intl's hand, the rows under it in
 * the app's — so the sign is decided in `Amount` and these hold it there. The
 * queries match on the text a reader sees; the space after the sign is a
 * non-breaking one, which the matcher folds into an ordinary space.
 */
describe("Amount", () => {
  it("writes a loss with a real minus and a space, whatever was asked", () => {
    renderWithIntl(<Amount minorUnits="-96084" currency="CHF" />);
    expect(screen.getByText("− CHF 960.84")).toBeVisible();
  });

  it("leaves a gain bare unless a sign is asked for", () => {
    renderWithIntl(<Amount minorUnits="96084" currency="CHF" />);
    expect(screen.getByText("CHF 960.84")).toBeVisible();
  });

  it("signs both directions for exceptZero and leaves zero alone", () => {
    renderWithIntl(
      <>
        <Amount minorUnits="197907" currency="CHF" signDisplay="exceptZero" />
        <Amount minorUnits="-101823" currency="CHF" signDisplay="exceptZero" />
        <Amount minorUnits="0" currency="CHF" signDisplay="exceptZero" />
      </>,
    );
    expect(screen.getByText("+ CHF 1,979.07")).toBeVisible();
    expect(screen.getByText("− CHF 1,018.23")).toBeVisible();
    expect(screen.getByText("CHF 0.00")).toBeVisible();
  });

  it("signs zero too when always is asked, and never when never is", () => {
    renderWithIntl(
      <>
        <Amount minorUnits="0" currency="EUR" signDisplay="always" />
        <Amount minorUnits="-4200" currency="EUR" signDisplay="never" />
      </>,
    );
    expect(screen.getByText("+ €0.00")).toBeVisible();
    expect(screen.getByText("€42.00")).toBeVisible();
  });

  it("keeps the sign in front of the figure whichever end the currency is at", () => {
    renderWithIntl(
      <FormatPreferencesProvider
        value={{
          dateFormat: DEFAULT_DATE_FORMAT,
          numberFormat: DEFAULT_NUMBER_FORMAT,
          formatLocale: "fr",
          timeZone: "UTC",
        }}
      >
        <Amount minorUnits="-96084" currency="CHF" signDisplay="exceptZero" />
      </FormatPreferencesProvider>,
      { locale: "fr" },
    );
    // French puts the code after the number; the sign still leads.
    expect(screen.getByText(/^− 960,84 CHF$/)).toBeVisible();
  });

  it("rounds to whole units when asked, sign intact", () => {
    renderWithIntl(
      <Amount
        minorUnits="-96084"
        currency="CHF"
        signDisplay="exceptZero"
        fractionDigits={0}
      />,
    );
    expect(screen.getByText("− CHF 961")).toBeVisible();
  });
});
