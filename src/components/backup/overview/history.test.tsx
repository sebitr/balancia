import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import type { RunView } from "@/modules/backup/service";
import { BackupHistory } from "./history";
import { NOW, run } from "./fixtures";

/**
 * The list of runs, and the one thing in it that opens.
 *
 * Every status is an icon and a word. A failed row is the only row that is a
 * button, and what it opens to is the reason somebody came: Balancia's sentence,
 * what to do, and the provider's own words in monospace, untranslated.
 */

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const FAILED = run({
  id: "f1",
  status: "failed",
  startedAt: new Date("2026-10-08T03:30:00.000Z"),
  finishedAt: new Date("2026-10-08T03:30:05.000Z"),
  groupCount: 0,
  bytes: 0,
  errorCode: "forbidden",
  errorDetail: "403 AccessDenied: the key cannot write to this bucket",
});

/** Holds which row is open, the way the overview does. */
function Harness({
  runs,
  initial = null,
}: {
  runs: readonly RunView[];
  initial?: string | null;
}) {
  const [openId, setOpenId] = useState<string | null>(initial);
  return (
    <BackupHistory
      runs={runs}
      provider="s3"
      now={NOW}
      openId={openId}
      onOpenChange={setOpenId}
    />
  );
}

function renderHistory(runs: readonly RunView[], initial?: string | null) {
  return {
    ...renderWithIntl(<Harness runs={runs} initial={initial} />, {
      area: "backup",
    }),
    user: userEvent.setup(),
  };
}

/** Ten runs, newest first, the third of them failed. */
function ten(): RunView[] {
  return Array.from({ length: 10 }, (_, index) =>
    index === 2
      ? { ...FAILED, id: "failed-3" }
      : run({
          id: `r${index}`,
          startedAt: new Date(Date.UTC(2026, 9, 9 - index, 3, 30)),
        }),
  );
}

describe("a row", () => {
  it("writes its status as a word beside an icon, whatever the colour", () => {
    renderHistory([
      run({ id: "ok" }),
      run({ id: "quiet", status: "unchanged", bytes: 0 }),
      FAILED,
      run({ id: "now", status: "running", finishedAt: null }),
    ]);

    for (const word of ["Backed up", "No changes", "Failed", "Running now"]) {
      const mark = screen.getByText(word);
      expect(mark.querySelector("svg")).not.toBeNull();
      // The icon is decoration: the word is what is read.
      expect(mark.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    }
  });

  it("gives a good run its time, its groups and its size", () => {
    renderHistory([run()]);

    expect(screen.getByText("Today, 3:30 AM")).toBeInTheDocument();
    expect(screen.getByText("3 groups · 212 kB")).toBeInTheDocument();
  });

  it("says why a night with no changes wrote nothing", () => {
    renderHistory([run({ status: "unchanged", bytes: 0 })]);

    expect(
      screen.getByText("Nothing changed since the last backup."),
    ).toBeInTheDocument();
  });

  it("is not a button unless it failed", () => {
    renderHistory([run(), FAILED]);

    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("states the sentence for the failure on its one line, in the provider's name", () => {
    renderHistory([run({ id: "q", status: "failed", errorCode: "quota" })]);

    expect(
      screen.getByText("Not enough space in your S3."),
    ).toBeInTheDocument();
  });
});

describe("a failed row", () => {
  it("opens to the sentence, what to do, and the provider's own words", async () => {
    const { user } = renderHistory([run(), FAILED]);
    const row = screen.getByRole("button", { name: /Failed/ });
    expect(row).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("What happened")).toBeNull();

    await user.click(row);

    expect(row).toHaveAttribute("aria-expanded", "true");
    const panel = document.getElementById(
      row.getAttribute("aria-controls") ?? "",
    ) as HTMLElement;
    expect(within(panel).getByText("What happened")).toBeInTheDocument();
    expect(
      within(panel).getByText("The account is not allowed to write there."),
    ).toBeInTheDocument();
    expect(
      within(panel).getByText(
        "Check that this key may write to the bucket, then test again.",
      ),
    ).toBeInTheDocument();
    expect(within(panel).getByText("The provider said")).toBeInTheDocument();
    // Verbatim, and in monospace: it is the provider's, not ours to translate.
    const words = within(panel).getByText(
      "403 AccessDenied: the key cannot write to this bucket",
    );
    expect(words.tagName).toBe("CODE");
    expect(words).toHaveClass("font-mono");
  });

  it("closes again", async () => {
    const { user } = renderHistory([FAILED], "f1");

    await user.click(screen.getByRole("button", { name: /Failed/ }));

    expect(screen.queryByText("What happened")).toBeNull();
  });

  it("leaves out the provider's words when it had none to give", async () => {
    const { user } = renderHistory([
      run({
        id: "f2",
        status: "failed",
        errorCode: "reconnect",
        errorDetail: "",
      }),
    ]);

    await user.click(screen.getByRole("button", { name: /Failed/ }));

    expect(screen.getByText("Reconnect to carry on.")).toBeInTheDocument();
    expect(screen.queryByText("The provider said")).toBeNull();
  });

  it("reads a code it does not know as something going wrong, never as a key", async () => {
    const { user } = renderHistory([
      run({
        id: "f3",
        status: "failed",
        errorCode: "from_a_newer_server" as RunView["errorCode"],
      }),
    ]);

    await user.click(screen.getByRole("button", { name: /Failed/ }));

    expect(screen.getAllByText("Something went wrong.").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText(/error\./)).toBeNull();
  });
});

describe("on a phone", () => {
  it("shows six rows, and the other four after 'Show 4 more'", async () => {
    const { user } = renderHistory(ten());
    const rows = screen.getAllByRole("listitem");
    expect(rows).toHaveLength(10);
    // Hidden below `lg` only: from `lg` all ten are drawn.
    expect(
      rows.slice(0, 6).every((row) => !row.className.includes("max-lg:hidden")),
    ).toBe(true);
    expect(
      rows.slice(6).every((row) => row.className.includes("max-lg:hidden")),
    ).toBe(true);

    await user.click(screen.getByRole("button", { name: "Show 4 more" }));

    expect(
      screen
        .getAllByRole("listitem")
        .some((row) => row.className.includes("max-lg:hidden")),
    ).toBe(false);
    expect(screen.queryByRole("button", { name: /Show \d more/ })).toBeNull();
  });

  it("offers nothing to show when there are six or fewer", () => {
    renderHistory(ten().slice(0, 6));

    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).toBeNull();
  });

  it("lets out a row that is opened from outside, if it was one of the hidden", () => {
    const runs = ten();
    runs[8] = { ...FAILED, id: "failed-9" };
    renderHistory(runs, "failed-9");

    expect(
      screen
        .getAllByRole("listitem")
        .some((row) => row.className.includes("max-lg:hidden")),
    ).toBe(false);
    expect(screen.getByText("What happened")).toBeInTheDocument();
  });
});

describe("with no runs", () => {
  it("draws nothing", () => {
    const { container } = renderHistory([]);

    expect(container).toBeEmptyDOMElement();
  });
});
