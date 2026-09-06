import { afterEach, describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { ShareButton } from "./invite-link-controls";

/**
 * The share button, at the moment it hands the link to another app.
 *
 * What it hands over is asserted as the text a person receives in their chat:
 * a message saying what the link is for, and the link on the line under it,
 * in one piece. jsdom has no share sheet, so one is put on `navigator` for
 * each test that needs it and taken away afterwards — `useCanShare` asks
 * whether the property exists, and the fallback tests in `group-ready.test`
 * rely on it not existing.
 */

const URL = "https://balancia.test/join/g/SECRET-TOKEN";

const MESSAGE =
  "Hey! I’ve set up Lisbon, March on Balancia so we can split what we spend without the headache. Open the link, pick your name and you’re in.";

function withShareSheet(share: (data: ShareData) => Promise<void>) {
  Object.defineProperty(navigator, "share", {
    value: share,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  // Deleted rather than set to undefined: `"share" in navigator` is the
  // question, and a property holding nothing still answers yes.
  delete (navigator as { share?: unknown }).share;
});

function renderShare() {
  renderWithIntl(<ShareButton url={URL} groupName="Lisbon, March" />);
  return screen.getByRole("button", { name: "Share" });
}

describe("ShareButton", () => {
  it("hands the sheet the message with the link on the line under it", async () => {
    const user = userEvent.setup();
    const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
    withShareSheet(share);

    await user.click(renderShare());

    // The whole payload, not just its text: a `url` field alongside the text
    // is what makes Android send the link twice and lets an iOS chat app keep
    // the link and drop the words.
    expect(share).toHaveBeenCalledOnce();
    expect(share).toHaveBeenCalledWith({
      title: "Lisbon, March on Balancia",
      text: `${MESSAGE}\n${URL}`,
    });
  });

  it("treats a dismissed sheet as a decision, not a failure", async () => {
    const user = userEvent.setup();
    withShareSheet(async () => {
      throw new DOMException("The reader closed it", "AbortError");
    });

    const button = renderShare();
    await user.click(button);

    expect(button).toHaveTextContent("Share");
    expect(await navigator.clipboard.readText()).toBe("");
  });

  it("copies the link instead when the sheet fails outright", async () => {
    const user = userEvent.setup();
    withShareSheet(async () => {
      throw new Error("nothing to share to");
    });

    const button = renderShare();
    await user.click(button);

    expect(button).toHaveTextContent("Copied");
    expect(await navigator.clipboard.readText()).toBe(URL);
  });
});
