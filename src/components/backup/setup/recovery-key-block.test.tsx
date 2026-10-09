import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import {
  keyFileText,
  RecoveryKeyBlock,
  splitIdentity,
} from "./recovery-key-block";

/**
 * The key as it is drawn, copied and saved.
 *
 * The block is the one place the private half is shown, so the tests are about
 * what a person can do with it: read it back in groups, put it on the
 * clipboard, and take a file that `age -d -i` opens as it is.
 */

// 16 characters of prefix, then 58: thirteen groups of four and a last six.
const BODY = "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7LQPZRY9X8GF2TVDW0S3JN54KHCE";
const IDENTITY = `AGE-SECRET-KEY-1${BODY}`;
const RECIPIENT =
  "age1recipientrecipientrecipientrecipientrecipientrecipientxyz";

describe("splitIdentity", () => {
  it("gives the prefix, groups of four, and a last group of six", () => {
    expect(IDENTITY).toHaveLength(74);
    const { prefix, groups, tail } = splitIdentity(IDENTITY);

    expect(prefix).toBe("AGE-SECRET-KEY-1");
    expect(groups).toHaveLength(13);
    expect(groups.every((group) => group.length === 4)).toBe(true);
    expect(tail).toBe("54KHCE");
    expect(`${prefix}${groups.join("")}${tail}`).toBe(IDENTITY);
  });

  it("copes with a key that is not the usual length", () => {
    const { groups, tail } = splitIdentity("AGE-SECRET-KEY-1ABCDEFGHIJ");
    expect(groups).toEqual(["ABCD"]);
    expect(tail).toBe("EFGHIJ");

    expect(splitIdentity("AGE-SECRET-KEY-1ABC")).toMatchObject({
      groups: [],
      tail: "ABC",
    });
  });
});

describe("keyFileText", () => {
  it("is laid out the way age-keygen lays out its own", () => {
    const lines = keyFileText(IDENTITY, RECIPIENT).split("\n");

    expect(lines[0]).toMatch(
      /^# created: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
    );
    expect(lines[1]).toBe(`# public key: ${RECIPIENT}`);
    expect(lines[2]).toBe(IDENTITY);
    expect(lines[3]).toBe("");
  });
});

describe("RecoveryKeyBlock", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("draws the prefix on a line of its own and outlines the last six", () => {
    renderWithIntl(
      <RecoveryKeyBlock identity={IDENTITY} recipient={RECIPIENT} />,
    );

    const block = screen.getByRole("group", { name: "Your recovery key" });
    expect(block).toHaveTextContent("AGE-SECRET-KEY-1");
    expect(screen.getByText("AGE-SECRET-KEY-1")).toBeInTheDocument();

    // The outline is a shape, not a colour: it is what "the last 6" points at.
    const tail = screen.getByText("54KHCE");
    expect(tail).toHaveClass("ring-2", "ring-foreground");
    expect(screen.getAllByText("QPZR")[0]).not.toHaveClass("ring-2");
  });

  describe("copying", () => {
    let writeText: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
      writeText = vi.fn().mockResolvedValue(undefined);
    });

    function setup() {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      // After `setup`, which installs a clipboard of its own.
      Object.defineProperty(navigator, "clipboard", {
        value: { writeText },
        configurable: true,
      });
      renderWithIntl(
        <RecoveryKeyBlock identity={IDENTITY} recipient={RECIPIENT} />,
      );
      return user;
    }

    it("puts the whole key on the clipboard and says Copied for two seconds", async () => {
      const user = setup();

      await user.click(screen.getByRole("button", { name: "Copy" }));

      expect(writeText).toHaveBeenCalledWith(IDENTITY);
      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(1900));
      expect(
        screen.getByRole("button", { name: "Copied" }),
      ).toBeInTheDocument();

      await act(() => vi.advanceTimersByTimeAsync(200));
      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });

    it("does not claim to have copied what the clipboard refused", async () => {
      writeText.mockRejectedValue(new Error("denied"));
      const user = setup();

      await user.click(screen.getByRole("button", { name: "Copy" }));

      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Copied" })).toBeNull();
      // Left selected instead, so Ctrl+C is one keystroke away.
      expect(window.getSelection()?.toString()).toContain("54KHCE");
    });

    it("copes with a page that has no clipboard at all", async () => {
      const user = setup();
      Object.defineProperty(navigator, "clipboard", {
        value: undefined,
        configurable: true,
      });

      await user.click(screen.getByRole("button", { name: "Copy" }));

      expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    });
  });

  describe("downloading", () => {
    it("saves balancia-recovery-key.txt in age-keygen's layout, then lets go of the address", async () => {
      const user = userEvent.setup();
      let saved: Blob | undefined;
      const createObjectURL = vi.fn((blob: Blob) => {
        saved = blob;
        return "blob:balancia-key";
      });
      const revokeObjectURL = vi.fn();
      // jsdom has neither; they are put in for this test and taken out again.
      Object.assign(URL, { createObjectURL, revokeObjectURL });
      const clicked: { download: string; href: string }[] = [];
      vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
        function (this: HTMLAnchorElement) {
          clicked.push({ download: this.download, href: this.href });
        },
      );

      renderWithIntl(
        <RecoveryKeyBlock identity={IDENTITY} recipient={RECIPIENT} />,
      );
      await user.click(
        screen.getByRole("button", { name: "Download as a file" }),
      );

      expect(clicked).toEqual([
        { download: "balancia-recovery-key.txt", href: "blob:balancia-key" },
      ]);
      const text = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsText(saved as Blob);
      });
      expect(text).toContain(`# public key: ${RECIPIENT}\n${IDENTITY}\n`);
      await vi.waitFor(() =>
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:balancia-key"),
      );
      // Nothing is left in the page afterwards.
      expect(document.querySelector("a[download]")).toBeNull();
      Reflect.deleteProperty(URL, "createObjectURL");
      Reflect.deleteProperty(URL, "revokeObjectURL");
    });
  });
});
