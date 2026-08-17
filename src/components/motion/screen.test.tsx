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
});
