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
import { InstallInstructions } from "./install-instructions";
import { InstallRow } from "./install-row";
import { resetInstallPromptForTests } from "./use-install-prompt";

/**
 * The deliberate entry point on Help & about, and the sheet it opens.
 *
 * The two are mounted together the way the app mounts them — the row on the
 * screen, the sheet outside it in the shell — because that separation is the
 * thing most likely to break: the request travels through the install store,
 * not through React state the row owns.
 */
function renderRow() {
  return render(
    <>
      <InstallRow />
      <InstallInstructions />
    </>,
  );
}

const installItem = () =>
  screen.queryByRole("button", { name: "Install Balancia" });

describe("InstallRow", () => {
  beforeEach(() => {
    localStorage.clear();
    setUserAgent(USER_AGENTS.androidChrome);
    resetInstallPromptForTests();
  });

  afterEach(restoreDisplayMode);

  describe("Android and desktop Chromium", () => {
    it("appears once the browser offers a native install", async () => {
      renderRow();
      expect(installItem()).toBeNull();

      fireBeforeInstallPrompt();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("fires the native prompt without showing instructions first", async () => {
      const user = userEvent.setup();
      renderRow();
      const event = fireBeforeInstallPrompt();

      await user.click(await screen.findByRole("button"));

      expect(event.prompt).toHaveBeenCalledOnce();
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    it("is offered on desktop Chromium too, where the banner is not", async () => {
      setUserAgent(USER_AGENTS.desktopChrome);
      resetInstallPromptForTests();
      renderRow();

      fireBeforeInstallPrompt();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("stands down once the app reports itself installed", async () => {
      renderRow();
      fireBeforeInstallPrompt();
      await waitFor(() => expect(installItem()).toBeInTheDocument());

      fireAppInstalled();

      await waitFor(() => expect(installItem()).toBeNull());
    });

    it("stays available after the proactive suggestion was dismissed", async () => {
      localStorage.setItem("balancia:install-dismissed", "1");
      resetInstallPromptForTests();
      renderRow();

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
      renderRow();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("explains the share-sheet route rather than faking a prompt", async () => {
      const user = userEvent.setup();
      renderRow();

      await user.click(await screen.findByRole("button"));

      const dialog = await screen.findByRole("dialog");
      expect(dialog).toHaveTextContent("Install Balancia");
      expect(dialog).toHaveTextContent("Share");
      expect(dialog).toHaveTextContent("Add to Home Screen");
      expect(dialog).toHaveTextContent("Add");
    });

    it("hands focus to the sheet it opens", async () => {
      const user = userEvent.setup();
      renderRow();

      await user.click(await screen.findByRole("button"));

      // The sheet is mounted by the shell rather than by the row, and opens
      // because the request travelled through the store rather than through
      // React state the row owns.
      const dialog = await screen.findByRole("dialog");
      await waitFor(() =>
        expect(dialog.contains(document.activeElement)).toBe(true),
      );
    });

    it("recognises an iPad, which borrows a desktop Mac user agent", async () => {
      setUserAgent(USER_AGENTS.ipadSafari, 5);
      resetInstallPromptForTests();
      renderRow();

      await waitFor(() => expect(installItem()).toBeInTheDocument());
    });

    it("says nothing once running from the home screen", async () => {
      stubIosStandalone();
      resetInstallPromptForTests();
      renderRow();

      await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
      expect(installItem()).toBeNull();
    });
  });

  describe("Chrome and Edge on iOS", () => {
    it("sends the user to Safari instead of showing steps that would fail", async () => {
      const user = userEvent.setup();
      setUserAgent(USER_AGENTS.iosChrome);
      resetInstallPromptForTests();
      renderRow();

      await user.click(await screen.findByRole("button"));

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
      renderRow();

      await user.click(await screen.findByRole("button"));

      expect(await screen.findByRole("dialog")).toHaveTextContent("Safari");
    });
  });

  describe("browsers that cannot install at all", () => {
    it("offers nothing on Firefox for Android", async () => {
      setUserAgent(USER_AGENTS.androidFirefox);
      resetInstallPromptForTests();
      renderRow();

      await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    });

    it("offers nothing on desktop Firefox", async () => {
      setUserAgent(USER_AGENTS.desktopFirefox);
      resetInstallPromptForTests();
      renderRow();

      await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    });

    it("offers nothing in a standalone window, whatever the browser", async () => {
      stubStandalone();
      resetInstallPromptForTests();
      renderRow();

      fireBeforeInstallPrompt();

      await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    });
  });
});
