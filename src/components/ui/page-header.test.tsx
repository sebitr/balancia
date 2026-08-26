import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader, PageHeaderClose } from "./page-header";

/**
 * That the arrow decides the shape.
 *
 * `<PageHeader>` takes no size: a screen says whether it was pushed here from
 * somewhere else, and the title follows. Written down because the two shapes
 * are one ternary apart, and a screen that opens on a `text-2xl` title beside
 * a back arrow is the exact regression the settings hub was drawn to avoid.
 */
describe("a page header", () => {
  it("titles a pushed screen as a row label beside its arrow", () => {
    render(
      <PageHeader
        title="Statistics"
        back={{ href: "/groups/g1", label: "Back to the group" }}
      />,
    );

    expect(screen.getByRole("heading", { level: 1 })).toHaveClass("text-base");
    expect(
      screen.getByRole("link", { name: "Back to the group" }),
    ).toHaveAttribute("href", "/groups/g1");
  });

  it("gives a screen that was not pushed here the room to name itself", () => {
    render(<PageHeader title="Settings" />);

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveClass("text-2xl");
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("keeps the row's height when the screen names itself below", () => {
    // A member's screen opens on their face and their name, so the header
    // carries the arrow and nothing else — and still has to hold its line.
    const { container } = render(
      <PageHeader back={{ href: "/groups/g1", label: "Back to the group" }} />,
    );

    expect(screen.queryByRole("heading")).toBeNull();
    expect(container.querySelector(".min-h-8\\.5")).not.toBeNull();
  });

  it("puts a trailing control at the far end of the same row", () => {
    render(
      <PageHeader
        title="Settings"
        trailing={<PageHeaderClose href="/dashboard" label="Close settings" />}
      />,
    );

    expect(
      screen.getByRole("link", { name: "Close settings" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
