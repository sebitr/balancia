import { afterEach, describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { fakeViewport, releaseViewport } from "../../../tests/helpers/viewport";
import { SettledGroups, type SettledGroupView } from "./settled-groups";

/**
 * The quiet end of the list, as rows in the same list as every other section.
 * Search is deliberately not shown until asked for: it is there for an account
 * with dozens of settled groups, and it should not occupy the eye of one that
 * has three.
 */

const NOW = "2026-08-13T12:00:00.000Z";

function group(id: string, name: string): SettledGroupView {
  return {
    id,
    name,
    icon: null,
    iconColor: null,
    participantCount: 2,
    lastActivityAt: "2026-07-23T12:00:00.000Z",
  };
}

const SETTLED = [
  group("a", "trip"),
  group("b", "Sunday football"),
  group("c", "House renovation"),
  group("d", "Bali 2025"),
  group("e", "Book club"),
  group("f", "Weekend in Rome"),
];

const ARCHIVED = [group("x", "Ski weekend 2024"), group("y", "Amsterdam '24")];

describe("SettledGroups", () => {
  it("gives each settled group a row under a counted label", () => {
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    expect(
      screen.getByRole("heading", { name: "Settled up · 6" }),
    ).toBeVisible();

    const row = screen.getByRole("link", { name: /Book club/ });
    expect(row).toHaveAttribute("href", "/groups/e");
    // No amount to show, so the row carries the word instead — and keeps its
    // right edge aligned with the sections above.
    expect(within(row).getByText("Settled")).toBeVisible();
    expect(within(row).getByText(/2 people/)).toBeVisible();
  });

  it("keeps the search field out of the way until it is asked for", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Search your groups" }),
    );

    expect(screen.getByRole("searchbox")).toBeVisible();
  });

  it("filters the rows as you type, case-insensitively", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    await user.click(
      screen.getByRole("button", { name: "Search your groups" }),
    );
    await user.type(screen.getByRole("searchbox"), "BOOK");

    expect(screen.getByRole("link", { name: /Book club/ })).toBeVisible();
    expect(
      screen.queryByRole("link", { name: /Bali 2025/ }),
    ).not.toBeInTheDocument();
  });

  it("says so when nothing matches, quoting what was typed", async () => {
    const user = userEvent.setup();
    renderWithIntl(<SettledGroups settled={SETTLED} archived={[]} now={NOW} />);

    await user.click(
      screen.getByRole("button", { name: "Search your groups" }),
    );
    await user.type(screen.getByRole("searchbox"), "zzz");

    expect(screen.getByText("No group matches “zzz”")).toBeVisible();
  });

  it("closes the archived rows behind one row of the same list", async () => {
    const user = userEvent.setup();
    renderWithIntl(
      <SettledGroups settled={[]} archived={ARCHIVED} now={NOW} />,
    );

    expect(
      screen.queryByRole("link", { name: /Ski weekend 2024/ }),
    ).not.toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: /2 archived groups/ });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);

    const row = screen.getByRole("link", { name: /Ski weekend 2024/ });
    expect(row).toBeVisible();
    expect(within(row).getByText("Archived")).toBeVisible();
    // Archived rows carry no meta line — only the settled ones do.
    expect(within(row).queryByText(/2 people/)).not.toBeInTheDocument();
  });

  it("renders nothing at all when there is neither", () => {
    const { container } = renderWithIntl(
      <SettledGroups settled={[]} archived={[]} now={NOW} />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});

/**
 * The search field is the last thing on the home screen, which is where a
 * phone keyboard opens: over the field and over every row it filters.
 *
 * jsdom lays nothing out and scrolls nothing, so both ends are stubbed — the
 * measurements the hook reads, and the `scrollTo` it calls. What is being
 * asserted is the arithmetic in between: that the field is aimed at the top of
 * the screen and not merely at the top edge of the keyboard, which is what the
 * browser does by itself and what leaves the results hidden.
 */
describe("SettledGroups under a phone keyboard", () => {
  const HEADER = 56;
  const GAP = 8;

  afterEach(() => {
    releaseViewport();
    document.querySelector("[data-slot='app-header']")?.remove();
    Object.defineProperty(window, "scrollY", { value: 0, configurable: true });
  });

  /** The sticky header the shell puts above every screen. */
  function stickyHeader() {
    const header = document.createElement("header");
    header.setAttribute("data-slot", "app-header");
    header.getBoundingClientRect = () =>
      ({ height: HEADER }) as unknown as DOMRect;
    document.body.append(header);
  }

  /** Puts `field` that far down a page already scrolled by `scrolled`. */
  function place(field: HTMLElement, top: number, scrolled: number) {
    field.getBoundingClientRect = () => ({ top }) as unknown as DOMRect;
    Object.defineProperty(window, "scrollY", {
      value: scrolled,
      configurable: true,
    });
  }

  function renderSettled() {
    const scrollTo = vi.fn();
    window.scrollTo = scrollTo;
    const { container } = renderWithIntl(
      <SettledGroups settled={SETTLED} archived={[]} now={NOW} />,
    );
    const room = () => container.querySelector("[data-slot='keyboard-room']");
    return { scrollTo, room };
  }

  async function openSearch() {
    await userEvent
      .setup()
      .click(screen.getByRole("button", { name: "Search your groups" }));
    return screen.getByRole("searchbox");
  }

  it("pulls the field to the top of the screen, not just clear of the keyboard", async () => {
    const viewport = fakeViewport();
    stickyHeader();
    const { scrollTo } = renderSettled();
    place(await openSearch(), 620, 100);

    viewport.keyboard(336);

    // Where the field sits in the document, less the header it would otherwise
    // end up behind: 620 + 100 - (56 + 8).
    expect(scrollTo).toHaveBeenCalledWith({ top: 656, behavior: "auto" });
  });

  it("adds the room that scroll spends, and takes it back afterwards", async () => {
    const viewport = fakeViewport();
    const { room } = renderSettled();
    place(await openSearch(), 620, 100);

    expect(room()).toBeNull();

    // Below the last row there is nothing left to scroll through, so without
    // this the page cannot move and the field stays where the keyboard is.
    viewport.keyboard(336);
    expect(room()).toHaveStyle({ height: "336px" });

    viewport.keyboard(0);
    expect(room()).toBeNull();
  });

  it("leaves the page alone on a desktop, where nothing is covered", async () => {
    const viewport = fakeViewport();
    stickyHeader();
    const { scrollTo, room } = renderSettled();
    place(await openSearch(), 620, 100);

    viewport.keyboard(0);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(room()).toBeNull();
  });

  /** A keyboard opened for something else is not this field's business. */
  it("stays put when the search was never opened", () => {
    const viewport = fakeViewport();
    stickyHeader();
    const { scrollTo, room } = renderSettled();

    viewport.keyboard(336);

    expect(scrollTo).not.toHaveBeenCalled();
    expect(room()).toBeNull();
  });

  it("clears the header it would otherwise hide behind", async () => {
    const viewport = fakeViewport();
    const { scrollTo } = renderSettled();
    place(await openSearch(), 620, 100);

    viewport.keyboard(336);

    // No header in the document: the field goes to the very top, less the gap.
    expect(scrollTo).toHaveBeenCalledWith({
      top: 720 - GAP,
      behavior: "auto",
    });
  });
});
