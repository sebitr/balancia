import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  FormatPreferencesProvider,
  useDateFormatter,
  useNumberLocale,
} from "./format-context";
import type { DateFormat, NumberFormat } from "./format";
import { formatMoney, money } from "@/modules/currencies/money";

/**
 * That a reader's notation actually reaches the components that write with it.
 *
 * The provider is the only thing standing between a preference in a cookie and
 * an amount on screen, so these render the real hooks rather than asserting on
 * the resolution logic, which `format.test.ts` covers directly.
 */

function Sample() {
  const dates = useDateFormatter();
  const locale = useNumberLocale();
  return (
    <>
      <span data-testid="date">{dates.plain("2026-08-13")}</span>
      <span data-testid="amount">
        {formatMoney(money(123456n, "EUR"), { locale })}
      </span>
    </>
  );
}

function renderWith(preferences: {
  dateFormat: DateFormat;
  numberFormat: NumberFormat;
  formatLocale: string;
}) {
  return render(
    <FormatPreferencesProvider value={{ ...preferences, timeZone: "UTC" }}>
      <Sample />
    </FormatPreferencesProvider>,
  );
}

describe("the format preferences provider", () => {
  it("writes dates and amounts the way the reader chose", () => {
    renderWith({
      dateFormat: "ymd",
      numberFormat: "dot-comma",
      formatLocale: "en",
    });
    expect(screen.getByTestId("date")).toHaveTextContent("2026-08-13");
    expect(screen.getByTestId("amount")).toHaveTextContent("1.234,56 €");
  });

  it("follows the reader's own region when both are automatic", () => {
    renderWith({
      dateFormat: "auto",
      numberFormat: "auto",
      formatLocale: "en-GB",
    });
    expect(screen.getByTestId("date")).toHaveTextContent("13 Aug 2026");
    expect(screen.getByTestId("amount")).toHaveTextContent("€1,234.56");
  });

  it("falls back to the defaults when nothing provides it", () => {
    // A component rendered in isolation should show a date, not throw.
    render(<Sample />);
    expect(screen.getByTestId("date")).toHaveTextContent("Aug 13, 2026");
  });
});
