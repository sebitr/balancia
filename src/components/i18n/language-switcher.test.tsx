import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
const localeAction = vi.hoisted(() => ({ set: vi.fn() }));
const loadDocument = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

vi.mock("@/i18n/actions", () => ({
  setLocaleAction: localeAction.set,
}));

vi.mock("@/lib/load-document", () => ({ loadDocument }));

const { MarketingLanguageSwitcher } = await import("./language-switcher");

/** The homepage's two addresses, as `localePaths("home")` hands them over. */
const PATHS = { en: "/", fr: "/fr" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("MarketingLanguageSwitcher", () => {
  it("shows the language of the page being read in the trigger", () => {
    renderWithIntl(<MarketingLanguageSwitcher paths={PATHS} />, {
      locale: "fr",
    });

    expect(
      screen.getByRole("button", { name: "Langue: Français" }),
    ).toHaveTextContent("🇫🇷FR");
  });

  it("lists both languages and marks the active one", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MarketingLanguageSwitcher paths={PATHS} />, {
      locale: "en",
    });

    await user.click(screen.getByRole("button", { name: "Language: English" }));

    const menu = screen.getByRole("menu", { name: "Language: English" });
    expect(
      within(menu).getByText("English").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-current", "true");
    expect(within(menu).getByText("Français")).toBeInTheDocument();
  });

  it("persists a choice, then goes to that language's own address", async () => {
    // The order is the point. `/` sends a reader whose browser asks for
    // French on to `/fr`, so somebody choosing English from there has to have
    // the cookie that says so before the request for `/` is made — or the
    // page they asked for sends them straight back.
    const user = userEvent.setup();
    const order: string[] = [];
    localeAction.set.mockImplementation(async () => {
      order.push("cookie");
    });
    loadDocument.mockImplementation(() => {
      order.push("navigate");
    });
    renderWithIntl(<MarketingLanguageSwitcher paths={PATHS} />, {
      locale: "fr",
    });

    await user.click(screen.getByRole("button", { name: "Langue: Français" }));
    await user.click(screen.getByRole("menuitem", { name: /English/ }));

    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith("/"));
    expect(localeAction.set).toHaveBeenCalledWith("en");
    expect(order).toEqual(["cookie", "navigate"]);
  });

  it("loads the address as a document, not through the router", async () => {
    // The root layout wrote `<html lang>` and the browser's messages in the
    // language it was first rendered in, and a soft navigation keeps a
    // layout. A refresh would redraw the same address in the same language.
    const user = userEvent.setup();
    localeAction.set.mockResolvedValue(undefined);
    renderWithIntl(<MarketingLanguageSwitcher paths={PATHS} />, {
      locale: "en",
    });

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("menuitem", { name: /Français/ }));

    await waitFor(() => expect(loadDocument).toHaveBeenCalledWith("/fr"));
    expect(navigation.refresh).not.toHaveBeenCalled();
  });

  it("does nothing when the language already being read is chosen", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MarketingLanguageSwitcher paths={PATHS} />, {
      locale: "en",
    });

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("menuitem", { name: /English/ }));

    expect(localeAction.set).not.toHaveBeenCalled();
    expect(loadDocument).not.toHaveBeenCalled();
  });
});
