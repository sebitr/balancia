import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl as render } from "../../../tests/helpers/intl";
import {
  USER_AGENTS,
  fireAppInstalled,
  fireBeforeInstallPrompt,
  restoreDisplayMode,
  setUserAgent,
  stubIosStandalone,
  stubStandalone,
} from "../../../tests/helpers/pwa";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { InstallInstructions } from "./install-instructions";
import { InstallMenuItem } from "./install-menu-item";
import { resetInstallPromptForTests } from "./use-install-prompt";

/**
 * The account-menu entry point, and the sheet it opens.
 *
 * The two are mounted together the way the app mounts them — the item inside a
 * menu that unmounts on close, the sheet outside it in the shell — because
 * that separation is the thing most likely to break.
 */
function renderMenu() {
  return render(
    <>
      <DropdownMenu defaultOpen>
        <DropdownMenuTrigger asChild>
          <Button>Account menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <InstallMenuItem />
        </DropdownMenuContent>
      </DropdownMenu>
      <InstallInstructions />
    </>,
  );
}

const installItem = () =>
  screen.queryByRole("menuitem", { name: "Install Balancia" });

describe("InstallMenuItem", () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent(USER_AGENTS.androidChrome);
    resetInstallPromptForTests();
  });

  afterEach(restoreDisplayMode);

  describe("Android and desktop Chromium", () => {
    it("appears once the browser offers a native install", async () => {
      renderMenu();
      expect(installItem()).toBeNull();

      fireBeforeInstallPrompt();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("fires the native prompt without showing instructions first", async () => {
      const user = userEvent.setup();
      renderMenu();
      const event = fireBeforeInstallPrompt();

      await user.click(await screen.findByRole("menuitem"));

      expect(event.prompt).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("is offered on desktop Chromium too, where the banner is not", async () => {
      setUserAgent(USER_AGENTS.desktopChrome);
      resetInstallPromptForTests();
      renderMenu();

      fireBeforeInstallPrompt();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("stands down once the app reports itself installed", async () => {
      renderMenu();
      fireBeforeInstallPrompt();
      await waitFor(() => expect(installItem()).toBeInTheDocument());

      fireAppInstalled();

      await waitFor(() => expect(installItem()).toBeNull());
    });

    it("stays available after the proactive suggestion was dismissed", async () => {
      localStorage.setItem("balancia:install-dismissed", "1");
      resetInstallPromptForTests();
      renderMenu();

      fireBeforeInstallPrompt();

      // Dismissal silences the nudge, never the deliberate choice.
      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });
  });

  describe("iOS and iPadOS Safari", () => {
    beforeEach(() => {
      setUserAgent(USER_AGENTS.iosSafari);
      resetInstallPromptForTests();
    });

    it("is offered even though no install event ever arrives", async () => {
      renderMenu();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("explains the share-sheet route rather than faking a prompt", async () => {
      const user = userEvent.setup();
      renderMenu();

      await user.click(await screen.findByRole("menuitem"));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Install Balancia");
      expect(dialog).toHaveTextContent("Share");
      expect(dialog).toHaveTextContent("Add to Home Screen");
      expect(dialog).toHaveTextContent("Add");
    });

    it("closes the menu and hands focus to the sheet", async () => {
      const user = userEvent.setup();
      renderMenu();

      await user.click(await screen.findByRole("menuitem"));

      // The item unmounts with the menu; the sheet opens regardless because
      // the request travelled through the store, not through React state.
      const dialog = await screen.findByRole("dialog");
      await waitFor(() => expect(screen.queryByRole("menu")).toBeNull());
      await waitFor(() =>
        expect(dialog.contains(document.activeElement)).toBe(true),
      );
    });

    it("recognises an iPad, which borrows a desktop Mac user agent", async () => {
      setUserAgent(USER_AGENTS.ipadSafari, 5);
      resetInstallPromptForTests();
      renderMenu();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("says nothing once running from the home screen", async () => {
      stubIosStandalone();
      resetInstallPromptForTests();
      renderMenu();

      await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
      expect(installItem()).toBeNull();
    });
  });

  describe("Chrome and Edge on iOS", () => {
    it("sends the user to Safari instead of showing steps that would fail", async () => {
      const user = userEvent.setup();
      setUserAgent(USER_AGENTS.iosChrome);
      resetInstallPromptForTests();
      renderMenu();

      await user.click(await screen.findByRole("menuitem"));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Safari");
      // No Android-style native affordance, and no share-sheet steps that
      // Chrome on iOS cannot honour.
      expect(dialog).not.toHaveTextContent("Add to Home Screen");
    });

    it("treats Edge on iOS the same way", async () => {
      const user = userEvent.setup();
      setUserAgent(USER_AGENTS.iosEdge);
      resetInstallPromptForTests();
      renderMenu();

      await user.click(await screen.findByRole("menuitem"));

      expect(await screen.findByRole("dialog")).toHaveTextContent("Safari");
    });
  });

  describe("browsers that cannot install at all", () => {
    it("offers nothing on Firefox for Android", async () => {
      setUserAgent(USER_AGENTS.androidFirefox);
      resetInstallPromptForTests();
      renderMenu();

      await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    });

    it("offers nothing on desktop Firefox", async () => {
      setUserAgent(USER_AGENTS.desktopFirefox);
      resetInstallPromptForTests();
      renderMenu();

      await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    });

    it("offers nothing in a standalone window, whatever the browser", async () => {
      stubStandalone();
      resetInstallPromptForTests();
      renderMenu();

      fireBeforeInstallPrompt();

      await waitFor(() => expect(screen.queryByRole("menuitem")).toBeNull());
    });
  });
});
