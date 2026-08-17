import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { CurrencyPicker } from "./currency-picker";
import { CurrencyFavoritesProvider } from "./currency-favorites";

/**
 * The currency list, on its own.
 *
 * The sheets that host it are tested where they live; what is checked here is
 * the list's own promises — that favourites are pinned and appear once, that
 * starring is not selecting, that the sections say the right thing while
 * somebody is typing, and that a search matching nothing says so.
 */

vi.mock("@/modules/profile/actions", () => ({
  setFavoriteCurrenciesAction: vi.fn().mockResolvedValue({ ok: true }),
}));

// A Radix dialog title outside a dialog would throw; the picker is always the
// content of one, so the test supplies the cheapest possible host.
vi.mock("@/components/ui/sheet", () => ({
  SheetTitle: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => <h2 className={className}>{children}</h2>,
}));

function renderPicker({
  value = "CHF",
  favorites = [],
}: { value?: string; favorites?: string[] } = {}) {
  const onSelect = vi.fn();
  const onBack = vi.fn();
  const view = renderWithIntl(
    <CurrencyFavoritesProvider initial={favorites} persist={false}>
      <CurrencyPicker
        value={value}
        title="Currency"
        onSelect={onSelect}
        onBack={onBack}
      />
    </CurrencyFavoritesProvider>,
  );
  return { ...view, onSelect, onBack, user: userEvent.setup() };
}

/** The rows of one section, by the heading above them. */
function section(name: string) {
  return within(screen.getByRole("heading", { name }).parentElement!);
}

/** The code a row is for. Its text starts with a flag, which is not one. */
function codeOf(row: HTMLElement): string | undefined {
  return row.textContent?.match(/[A-Z]{3}/)?.[0];
}

describe("the currency picker", () => {
  it("pins favourites above the list, and does not repeat them in it", () => {
    renderPicker({ favorites: ["THB", "CHF"] });

    const favourites = section("Favourites");
    // The reader's own order, not the alphabet: most recently starred last.
    expect(
      favourites.getAllByRole("button", { name: /^(THB|CHF)/ }).map(codeOf),
    ).toEqual(["THB", "CHF"]);

    const all = section("All currencies");
    expect(all.queryByRole("button", { name: /^CHF/ })).toBeNull();
    expect(all.getByRole("button", { name: /^AED/ })).toBeInTheDocument();
  });

  it("leaves the favourites section out when there are none", () => {
    renderPicker();
    expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "All currencies" }),
    ).toBeInTheDocument();
  });

  it("marks the currency already chosen without moving it", () => {
    renderPicker({ value: "JPY" });
    expect(screen.getByRole("button", { name: /^JPY/ })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("selects on a tap, with nothing to confirm", async () => {
    const { user, onSelect } = renderPicker();
    await user.click(screen.getByRole("button", { name: /^AUD/ }));
    expect(onSelect).toHaveBeenCalledWith("AUD");
  });

  /**
   * The star is a button inside the row the row-button also covers. If the tap
   * reached both, starring a currency would silently choose it and close the
   * sheet — which is the one thing the design says it must never do.
   */
  it("stars without selecting", async () => {
    const { user, onSelect } = renderPicker();

    await user.click(
      screen.getByRole("button", { name: "Add AUD to favourites" }),
    );

    expect(onSelect).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: "Remove AUD from favourites" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * Starring must not make the row jump out from under the finger that starred
   * it. The new order is read the next time the list opens.
   */
  it("does not resort itself while it is being looked at", async () => {
    const { user } = renderPicker();

    await user.click(
      screen.getByRole("button", { name: "Add AUD to favourites" }),
    );

    expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();
    expect(
      section("All currencies").getByRole("button", { name: /^AUD/ }),
    ).toBeInTheDocument();
  });

  describe("while searching", () => {
    it("collapses to one section that counts what matched", async () => {
      const { user } = renderPicker({ favorites: ["CHF"] });

      await user.type(
        screen.getByRole("textbox", { name: "Search a currency" }),
        "swiss",
      );

      expect(screen.queryByRole("heading", { name: "Favourites" })).toBeNull();
      expect(
        screen.getByRole("heading", { name: "1 result" }),
      ).toBeInTheDocument();
    });

    it("leads with favourites among the matches", async () => {
      const { user } = renderPicker({ favorites: ["USD"] });

      // Several dollars match; the starred one goes first whatever the alphabet
      // says, because it is the one this reader keeps reaching for.
      await user.type(
        screen.getByRole("textbox", { name: "Search a currency" }),
        "dollar",
      );

      const rows = screen.getAllByRole("button", { name: /^[A-Z]{3}/ });
      expect(codeOf(rows[0]!)).toBe("USD");
    });

    it("says so when nothing matches, and clears back to the list", async () => {
      const { user } = renderPicker();
      const search = screen.getByRole("textbox", { name: "Search a currency" });

      await user.type(search, "qqqq");
      expect(screen.getByText("No currency found")).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "All currencies" }),
      ).toBeNull();

      await user.click(screen.getByRole("button", { name: "Clear" }));
      expect(search).toHaveValue("");
      expect(
        screen.getByRole("heading", { name: "All currencies" }),
      ).toBeInTheDocument();
    });
  });
});
