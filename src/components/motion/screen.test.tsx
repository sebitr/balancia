import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Screen } from "./screen";

vi.mock("next/navigation", () => ({
  usePathname: () => "/groups/g1",
}));

describe("Screen", () => {
  it("clears the bottom navigation and iOS safe area when inset", () => {
    render(<Screen inset>Group content</Screen>);

    expect(screen.getByText("Group content")).toHaveClass(
      "pb-[calc(8rem+env(safe-area-inset-bottom))]",
    );
  });

  it("keeps the regular padding when there is no bottom navigation", () => {
    render(<Screen>Dashboard content</Screen>);

    expect(screen.getByText("Dashboard content")).not.toHaveClass(
      "pb-[calc(8rem+env(safe-area-inset-bottom))]",
    );
  });

  /**
   * Beside a group's rail, from `lg` up, there is no bar to clear, and a
   * screen holding a wide layout gets the room for it. Everything stated for
   * a phone is still there underneath: these only add `lg:` utilities.
   */
  it("drops the bar's inset beside a rail, and widens for a wide layout", () => {
    render(
      <Screen inset rail>
        Group content
      </Screen>,
    );

    const column = screen.getByText("Group content");
    expect(column).toHaveClass(
      "max-w-3xl",
      "px-4",
      "pb-[calc(8rem+env(safe-area-inset-bottom))]",
      "lg:pb-12",
      "lg:has-data-[layout=wide]:max-w-5xl",
    );
  });

  it("changes nothing at any width for a screen with no rail", () => {
    render(<Screen inset>Group content</Screen>);

    expect(
      [...screen.getByText("Group content").classList].filter((name) =>
        name.startsWith("lg:"),
      ),
    ).toEqual([]);
  });
});
