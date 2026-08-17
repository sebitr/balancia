import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";

const navigation = vi.hoisted(() => ({ refresh: vi.fn() }));
const localeAction = vi.hoisted(() => ({ set: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: navigation.refresh }),
}));

vi.mock("@/i18n/actions", () => ({
  setLocaleAction: localeAction.set,
}));

const { MarketingLanguageSwitcher } = await import("./language-switcher");

describe("MarketingLanguageSwitcher", () => {
  it("shows the automatically resolved locale in the trigger", () => {
    renderWithIntl(<MarketingLanguageSwitcher />, { locale: "fr" });

    expect(
      screen.getByRole("button", { name: "Langue: Français" }),
    ).toHaveTextContent("🇫🇷FR");
  });

  it("lists both languages and marks the active one", async () => {
    const user = userEvent.setup();
    renderWithIntl(<MarketingLanguageSwitcher />, { locale: "en" });

    await user.click(screen.getByRole("button", { name: "Language: English" }));

    const menu = screen.getByRole("menu", { name: "Language: English" });
    expect(
      within(menu).getByText("English").closest("[role=menuitem]"),
    ).toHaveAttribute("aria-current", "true");
    expect(within(menu).getByText("Français")).toBeInTheDocument();
  });

  it("persists a choice and refreshes the server-rendered page", async () => {
    const user = userEvent.setup();
    localeAction.set.mockResolvedValue(undefined);
    renderWithIntl(<MarketingLanguageSwitcher />, { locale: "en" });

    await user.click(screen.getByRole("button", { name: "Language: English" }));
    await user.click(screen.getByRole("menuitem", { name: /Français/ }));

    expect(localeAction.set).toHaveBeenCalledWith("fr");
    expect(navigation.refresh).toHaveBeenCalledOnce();
  });
});
