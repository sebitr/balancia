import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { OutstandingList, type DebtPair } from "./settle-blocks";

/**
 * The list of debts on the repayment sheet: the ink of the selected figure
 * follows the reader's side of the debt, and one pair in two currencies is two
 * rows, not a key collision.
 */

const pair = (overrides: Partial<DebtPair> = {}): DebtPair => ({
  fromParticipantId: "me",
  fromName: "Robin",
  toParticipantId: "kat",
  toName: "Katherine",
  amountMinor: "95800",
  currency: "EUR",
  amountFormatted: "€958.00",
  ...overrides,
});

afterEach(() => vi.restoreAllMocks());

describe("the selected figure", () => {
  it("is red when the reader pays", () => {
    renderWithIntl(
      <OutstandingList
        pairs={[pair()]}
        selectedIndex={0}
        onSelect={vi.fn()}
        selfId="me"
      />,
    );
    const figure = screen.getByText("€958.00");
    expect(figure).toHaveClass("text-negative-ink");
    expect(figure).not.toHaveClass("text-positive-ink");
  });

  it("is green when the reader is paid", () => {
    renderWithIntl(
      <OutstandingList
        pairs={[pair()]}
        selectedIndex={0}
        onSelect={vi.fn()}
        selfId="kat"
      />,
    );
    expect(screen.getByText("€958.00")).toHaveClass("text-positive-ink");
  });

  it("is plain ink between two other people", () => {
    renderWithIntl(
      <OutstandingList
        pairs={[pair()]}
        selectedIndex={0}
        onSelect={vi.fn()}
        selfId="someone-else"
      />,
    );
    const figure = screen.getByText("€958.00");
    expect(figure).not.toHaveClass("text-positive-ink");
    expect(figure).not.toHaveClass("text-negative-ink");
  });
});

describe("one pair in two currencies", () => {
  it("renders two rows without a duplicate key", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    renderWithIntl(
      <OutstandingList
        pairs={[
          pair(),
          pair({
            currency: "JPY",
            amountMinor: "12000",
            amountFormatted: "¥12,000",
          }),
        ]}
        selectedIndex={0}
        onSelect={vi.fn()}
        selfId="me"
      />,
    );
    expect(screen.getByText("€958.00")).toBeInTheDocument();
    expect(screen.getByText("¥12,000")).toBeInTheDocument();
    const keyWarnings = error.mock.calls.filter((call) =>
      String(call[0]).includes("same key"),
    );
    expect(keyWarnings).toEqual([]);
  });
});
