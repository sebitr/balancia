import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fr from "../../../../messages/fr.json";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { DestinationCard } from "./destination-card";
import { destination, GROUPS, NOW, run } from "./fixtures";

/**
 * The card for one destination: what it says, the switch, and the one button.
 *
 * What these pin is mostly what the card does *not* do. The pause switch saves
 * and says nothing, because it is its own way back; "Back up now" shows its
 * progress and its result in place and says nothing, because a toast would be a
 * slower copy of a line under the finger. The two things that are spoken are
 * the two a control cannot carry: a refusal, which puts the control back, and a
 * manual run that failed.
 */

const { update, runNow, remove, estimate, toastSuccess, toastError, router } =
  vi.hoisted(() => ({
    update: vi.fn(),
    runNow: vi.fn(),
    remove: vi.fn(),
    estimate: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    router: { push: vi.fn(), refresh: vi.fn() },
  }));

vi.mock("@/modules/backup/actions", () => ({
  updateDestinationAction: update,
  runBackupNowAction: runNow,
  removeDestinationAction: remove,
  estimateReceiptsAction: estimate,
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/settings/backup",
}));

type Props = ComponentProps<typeof DestinationCard>;

function renderCard(props: Partial<Props> = {}) {
  const base: Props = {
    destination: destination(),
    runs: [run()],
    groups: GROUPS,
    keyFingerprint: "9f3a07c2",
    now: NOW,
  };
  const view = renderWithIntl(<DestinationCard {...base} {...props} />, {
    area: "backup",
  });
  return {
    ...view,
    user: userEvent.setup(),
    again: (next: Partial<Props>) =>
      view.rerender(<DestinationCard {...base} {...props} {...next} />),
  };
}

const auto = () => screen.getByRole("switch", { name: "Automatic backups" });
const backUpNow = () =>
  screen.getByRole("button", { name: /Back up now|Backing up/ });

/** The value under a fact's label. */
function factOf(label: string): string {
  return (
    screen.getByText(label).closest("div")?.querySelector("dd")?.textContent ??
    ""
  );
}

beforeEach(() => {
  update
    .mockReset()
    .mockResolvedValue({ ok: true, data: { ok: true, value: null } });
  runNow.mockReset().mockResolvedValue({
    ok: true,
    data: { ok: true, value: { started: true } },
  });
  remove
    .mockReset()
    .mockResolvedValue({ ok: true, data: { ok: true, value: null } });
  estimate
    .mockReset()
    .mockResolvedValue({ ok: true, data: { count: 12, bytes: 38_000_000 } });
  toastSuccess.mockReset();
  toastError.mockReset();
  router.push.mockReset();
  router.refresh.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("what the card says", () => {
  it("names the provider and the account, and the three facts", () => {
    renderCard();

    expect(
      screen.getByRole("heading", { name: "Google Drive" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ada@example.com")).toBeInTheDocument();
    // Built from the last run that wrote a file, in the reader's own clock.
    expect(factOf("Last backup")).toBe("Today, 3:30 AM · 3 groups · 212 kB");
    expect(factOf("Next backup")).toBe("Tomorrow, around 3:30 AM");
    expect(factOf("Schedule")).toBe("Daily · keeps the last 10");
  });

  it("says 'Just now' for a backup that finished a minute ago", () => {
    const fresh = run({
      id: "r2",
      startedAt: new Date("2026-10-09T15:29:00.000Z"),
      finishedAt: new Date("2026-10-09T15:29:30.000Z"),
    });
    renderCard({
      destination: destination({ latestRun: fresh, latestSuccess: fresh }),
      runs: [fresh],
    });

    expect(factOf("Last backup")).toBe("Just now · 3 groups · 212 kB");
  });

  it("does not call a night with no changes the last backup's size", () => {
    // The unchanged run is the latest success, and it wrote nothing: the size
    // shown is the one from the run before, which did.
    const quiet = run({
      id: "r2",
      status: "unchanged",
      bytes: 0,
      startedAt: new Date("2026-10-09T03:30:00.000Z"),
    });
    const written = run({
      id: "r1",
      startedAt: new Date("2026-10-08T03:30:00.000Z"),
      finishedAt: new Date("2026-10-08T03:30:12.000Z"),
    });
    renderCard({
      destination: destination({ latestRun: quiet, latestSuccess: quiet }),
      runs: [quiet, written],
    });

    expect(factOf("Last backup")).toBe(
      "Yesterday, 3:30 AM · 3 groups · 212 kB",
    );
  });

  it("says so when nothing has been backed up yet", () => {
    renderCard({
      destination: destination({
        latestRun: null,
        latestSuccess: null,
        lastSuccessAt: null,
      }),
      runs: [],
    });

    expect(factOf("Last backup")).toBe("—");
  });

  it("says when it will try again after a failure, in hours", () => {
    renderCard({
      destination: destination({
        consecutiveFailures: 2,
        nextRunAt: new Date("2026-10-09T19:30:00.000Z"),
      }),
    });

    expect(factOf("Next backup")).toBe("Trying again in about 4 hours");
  });

  it("says Paused for a destination that is paused, and says it twice", () => {
    renderCard({ destination: destination({ status: "paused" }) });

    expect(factOf("Next backup")).toBe("Paused");
    expect(
      screen.getByText("Paused", { selector: "span" }),
    ).toBeInTheDocument();
    expect(auto()).not.toBeChecked();
    expect(
      screen.getByText("Paused. Nothing is backed up until you turn this on."),
    ).toBeInTheDocument();
  });

  it("says how many receipts are still to go, and no more than the backend knows", () => {
    const last = run({ receiptsPending: 140 });
    renderCard({
      destination: destination({
        includeReceipts: true,
        latestRun: last,
        latestSuccess: last,
      }),
    });

    // How many have gone up is not stored, so it is not said.
    expect(factOf("Receipts")).toBe("140 receipts still to go");
    expect(screen.queryByText(/uploaded/)).toBeNull();
    expect(screen.getByText(/They go up a few at a time/)).toBeInTheDocument();
  });

  it("says one receipt in the singular", () => {
    const last = run({ receiptsPending: 1 });
    renderCard({
      destination: destination({
        includeReceipts: true,
        latestRun: last,
        latestSuccess: last,
      }),
    });

    expect(factOf("Receipts")).toBe("1 receipt still to go");
  });

  it("says all receipts are up once none are left", () => {
    renderCard({ destination: destination({ includeReceipts: true }) });

    expect(factOf("Receipts")).toBe("All uploaded");
  });

  it("draws no receipts fact when receipts are off", () => {
    renderCard();

    expect(screen.queryByText("Receipts")).toBeNull();
  });
});

describe("the pause switch", () => {
  it("pauses on a press, in silence", async () => {
    const { user } = renderCard();
    expect(auto()).toBeChecked();

    await user.click(auto());

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { paused: true }),
    );
    expect(auto()).not.toBeChecked();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
    // The card follows the switch at once rather than when the server answers.
    expect(factOf("Next backup")).toBe("Paused");
  });

  it("resumes from the same switch, in silence", async () => {
    const { user } = renderCard({
      destination: destination({ status: "paused" }),
    });

    await user.click(auto());

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { paused: false }),
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("goes back when the server refuses, and says so", async () => {
    update.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "notFound", detail: "" },
    });
    const { user } = renderCard();

    await user.click(auto());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That change could not be saved.",
      ),
    );
    // The control never keeps a value the account did not.
    expect(auto()).toBeChecked();
    expect(screen.queryByText("Paused", { selector: "span" })).toBeNull();
  });

  it("goes back when the action itself fails", async () => {
    update.mockResolvedValue({ ok: false, error: "Something went wrong." });
    const { user } = renderCard();

    await user.click(auto());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That change could not be saved.",
      ),
    );
    expect(auto()).toBeChecked();
  });

  it("goes back when the request never arrives", async () => {
    update.mockRejectedValue(new Error("offline"));
    const { user } = renderCard();

    await user.click(auto());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "That change could not be saved.",
      ),
    );
    expect(auto()).toBeChecked();
  });

  it("cannot be pressed for a destination waiting to be reconnected", async () => {
    const { user } = renderCard({
      destination: destination({
        status: "needs_reconnect",
        attention: "reconnect",
      }),
    });

    // The server pauses only a destination that is running: a press here would
    // leave the switch saying something the account does not hold.
    expect(auto()).toBeDisabled();
    await user.click(auto());
    expect(update).not.toHaveBeenCalled();
    expect(factOf("Next backup")).toBe("Waiting until you reconnect");
  });
});

describe("Back up now", () => {
  it("asks for a run and looks again", async () => {
    const { user } = renderCard();

    await user.click(backUpNow());

    expect(runNow).toHaveBeenCalledWith("d1");
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("is off when the destination has to be reconnected", () => {
    renderCard({
      destination: destination({
        status: "needs_reconnect",
        attention: "reconnect",
      }),
    });

    expect(backUpNow()).toBeDisabled();
  });

  it("treats a run that is already going as no error at all", async () => {
    runNow.mockResolvedValue({
      ok: true,
      data: { ok: true, value: { started: false } },
    });
    const { user } = renderCard();

    await user.click(backUpNow());

    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toastError).not.toHaveBeenCalled();
  });

  it("speaks a refusal in the words the screen has for it", async () => {
    runNow.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "reconnect", detail: "" },
    });
    const { user } = renderCard();

    await user.click(backUpNow());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Access was revoked or has expired.",
      ),
    );
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("speaks a request that never arrived, and puts the button back", async () => {
    runNow.mockRejectedValue(new Error("offline"));
    const { user } = renderCard();

    await user.click(backUpNow());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The backup could not be started.",
      ),
    );
    expect(backUpNow()).toBeEnabled();
  });

  it("speaks a fault, and puts the button back", async () => {
    runNow.mockResolvedValue({ ok: false, error: "Too many attempts." });
    const { user } = renderCard();

    await user.click(backUpNow());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Too many attempts."),
    );
    expect(backUpNow()).toBeEnabled();
  });
});

describe("a run that is under way", () => {
  const going = () =>
    run({
      id: "r2",
      trigger: "manual",
      status: "running",
      finishedAt: null,
      groupCount: 0,
      bytes: 0,
    });

  it("shows the bar and the words, and the button busy", () => {
    renderCard({
      destination: destination({ latestRun: going() }),
      runs: [going(), run()],
    });

    expect(screen.getByRole("progressbar")).toBeInTheDocument();
    expect(screen.getByText("Encrypting and uploading")).toBeInTheDocument();
    const button = backUpNow();
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleName("Backing up…");
  });

  it("looks again every two seconds, and stops when it is over", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { again } = renderCard({
      destination: destination({ latestRun: going() }),
    });

    await act(async () => {
      vi.advanceTimersByTime(6000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(3);

    const done = run({ id: "r2", trigger: "manual" });
    again({
      destination: destination({ latestRun: done, latestSuccess: done }),
    });
    router.refresh.mockClear();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("stops looking when the card goes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { unmount } = renderCard({
      destination: destination({ latestRun: going() }),
    });
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(router.refresh).toHaveBeenCalledTimes(1);

    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });

    expect(router.refresh).toHaveBeenCalledTimes(1);
  });

  it("gives up after ten minutes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderCard({ destination: destination({ latestRun: going() }) });

    await act(async () => {
      vi.advanceTimersByTime(11 * 60 * 1000);
    });
    const calls = router.refresh.mock.calls.length;
    expect(calls).toBeGreaterThan(250);
    await act(async () => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(router.refresh).toHaveBeenCalledTimes(calls);
  });

  it("shows the result where the progress was, with no toast", () => {
    const view = renderCard({
      destination: destination({ latestRun: going() }),
      runs: [going(), run()],
    });
    expect(screen.getByRole("progressbar")).toBeInTheDocument();

    const done = run({
      id: "r2",
      trigger: "manual",
      startedAt: new Date("2026-10-09T15:29:50.000Z"),
      finishedAt: new Date("2026-10-09T15:29:59.000Z"),
      groupCount: 14,
      bytes: 212_000,
    });
    view.again({
      destination: destination({ latestRun: done, latestSuccess: done }),
      runs: [done, run()],
    });

    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(
      screen.getByText("Backed up just now · 14 groups · 212 kB"),
    ).toBeInTheDocument();
    expect(backUpNow()).toBeEnabled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("shows a run that was over before the screen could see it start", async () => {
    const { user, again } = renderCard();
    await user.click(backUpNow());
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());

    // The next look at the server finds a finished run that was not there.
    const done = run({
      id: "r2",
      trigger: "manual",
      startedAt: new Date("2026-10-09T15:29:50.000Z"),
      finishedAt: new Date("2026-10-09T15:29:51.000Z"),
    });
    again({
      destination: destination({ latestRun: done, latestSuccess: done }),
    });

    expect(
      screen.getByText("Backed up just now · 3 groups · 212 kB"),
    ).toBeInTheDocument();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("does not claim a run it never saw started", () => {
    // A finished run on arrival is the card's "Last backup", not a result.
    renderCard();

    expect(screen.queryByText(/Backed up just now/)).toBeNull();
  });

  it("speaks a manual run that failed, once, and leaves the rest to History", () => {
    const view = renderCard({
      destination: destination({ latestRun: going() }),
    });
    const failed = run({
      id: "r2",
      trigger: "manual",
      status: "failed",
      groupCount: 0,
      bytes: 0,
      errorCode: "quota",
    });

    view.again({
      destination: destination({ latestRun: failed, consecutiveFailures: 1 }),
    });
    view.again({
      destination: destination({ latestRun: failed, consecutiveFailures: 1 }),
    });

    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError).toHaveBeenCalledWith(
      "Not enough space in your Google Drive.",
    );
  });

  it("says nothing of a scheduled run that failed", () => {
    const view = renderCard({
      destination: destination({
        latestRun: run({ id: "r2", status: "running", finishedAt: null }),
      }),
    });

    view.again({
      destination: destination({
        latestRun: run({
          id: "r2",
          trigger: "schedule",
          status: "failed",
          errorCode: "unreachable",
        }),
      }),
    });

    expect(toastError).not.toHaveBeenCalled();
  });
});

describe("Manage", () => {
  async function openManage() {
    const view = renderCard();
    await view.user.click(screen.getByRole("button", { name: "Manage" }));
    return view;
  }

  it("is closed until it is opened", () => {
    renderCard();

    expect(screen.getByRole("button", { name: "Manage" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(screen.queryByText("Backups to keep")).toBeNull();
  });

  it("saves Weekly as it is pressed, in silence", async () => {
    const { user } = await openManage();

    await user.click(screen.getByRole("button", { name: "Weekly" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { frequency: "weekly" }),
    );
    expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // The card above it follows.
    expect(factOf("Schedule")).toBe("Weekly · keeps the last 10");
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("saves how many to keep", async () => {
    const { user } = await openManage();

    await user.click(screen.getByRole("button", { name: "20" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { keepLast: 20 }),
    );
    expect(factOf("Schedule")).toBe("Daily · keeps the last 20");
  });

  it("offers a stored count that is not one of the four as a fifth", async () => {
    const view = renderCard({ destination: destination({ keepLast: 12 }) });
    await view.user.click(screen.getByRole("button", { name: "Manage" }));

    expect(screen.getByRole("button", { name: "12" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getAllByRole("button", { name: /^(5|10|12|20|30)$/ }),
    ).toHaveLength(5);
  });

  it("puts a flicked-back chip back when the server refuses", async () => {
    update.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "notFound", detail: "" },
    });
    const { user } = await openManage();

    await user.click(screen.getByRole("button", { name: "Weekly" }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("says how many are in each group, and when it last changed", async () => {
    await openManage();

    expect(screen.getByText("3 members · changed Oct 8")).toBeInTheDocument();
    // No activity to date, so nothing is said about when.
    expect(screen.getByText("8 members")).toBeInTheDocument();
    expect(screen.getByText("1 member")).toBeInTheDocument();
  });

  it("leaves a group out when it is unticked", async () => {
    const { user } = await openManage();

    await user.click(screen.getByRole("checkbox", { name: /^Lisbon, March/ }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { excludedGroupIds: ["g2"] }),
    );
    expect(screen.getByText("5 of 6 groups")).toBeInTheDocument();
  });

  it("takes a group back in when it is ticked again", async () => {
    const view = renderCard({
      destination: destination({ excludedGroupIds: ["g2"] }),
    });
    await view.user.click(screen.getByRole("button", { name: "Manage" }));
    expect(
      screen.getByRole("checkbox", { name: /^Lisbon, March/ }),
    ).not.toBeChecked();

    await view.user.click(
      screen.getByRole("checkbox", { name: /^Lisbon, March/ }),
    );

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { excludedGroupIds: [] }),
    );
  });

  it("keeps the ids of groups it no longer lists when it changes the rest", async () => {
    // A group the account stopped owning is still left out, and stays so.
    const view = renderCard({
      destination: destination({ excludedGroupIds: ["gone"] }),
    });
    await view.user.click(screen.getByRole("button", { name: "Manage" }));

    await view.user.click(screen.getByRole("checkbox", { name: /^Flat/ }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", {
        excludedGroupIds: ["gone", "g1"],
      }),
    );
  });

  it("will not untick the last group", async () => {
    const view = renderCard({
      groups: GROUPS.slice(0, 2),
      destination: destination({ excludedGroupIds: ["g2"] }),
    });
    await view.user.click(screen.getByRole("button", { name: "Manage" }));

    await view.user.click(screen.getByRole("checkbox", { name: /^Flat/ }));

    expect(update).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: /^Flat/ })).toBeChecked();
    expect(toastError).toHaveBeenCalledWith("That change could not be saved.");
  });

  it("shows four groups, then all of them", async () => {
    const { user } = await openManage();

    expect(screen.getAllByRole("checkbox")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Show all 6 groups" }));

    expect(screen.getAllByRole("checkbox")).toHaveLength(6);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
  });

  it("turns receipts on and says what they come to for the groups ticked", async () => {
    const { user } = await openManage();
    // The disclaimer is there before the switch is touched.
    expect(
      screen.getByText(/Receipts are bigger than your data/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/About 38 MB/)).toBeNull();

    await user.click(
      screen.getByRole("switch", { name: "Also back up receipts" }),
    );

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("d1", { includeReceipts: true }),
    );
    expect(
      await screen.findByText("About 38 MB of receipts across 6 groups"),
    ).toBeInTheDocument();
    expect(estimate).toHaveBeenCalledWith([]);
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("asks again for the groups left ticked", async () => {
    const view = renderCard({
      destination: destination({ includeReceipts: true }),
    });
    await view.user.click(screen.getByRole("button", { name: "Manage" }));
    await screen.findByText(/About 38 MB/);

    await view.user.click(screen.getByRole("checkbox", { name: /^Flat/ }));

    // The estimate is for the groups still ticked, so it is asked again with
    // the one just left out.
    await waitFor(() => expect(estimate).toHaveBeenLastCalledWith(["g1"]));
  });

  it("adds a quiet line for a very large estimate", async () => {
    estimate.mockResolvedValue({
      ok: true,
      data: { count: 9000, bytes: 4_000_000_000 },
    });
    const view = renderCard({
      destination: destination({ includeReceipts: true }),
    });
    await view.user.click(screen.getByRole("button", { name: "Manage" }));

    expect(
      await screen.findByText(/About 4 GB of receipts/),
    ).toBeInTheDocument();
    expect(
      screen.getByText("That is a lot for a free cloud plan."),
    ).toBeInTheDocument();
  });

  it("names the key by its fingerprint, in two halves", async () => {
    await openManage();

    expect(screen.getByText("Locked with key 9f3a 07c2")).toBeInTheDocument();
  });

  it("links to Where to back up with the destination to replace", async () => {
    await openManage();

    expect(
      screen.getByRole("link", { name: /Where to back up/ }),
    ).toHaveAttribute("href", "/settings/backup/setup?step=where&replace=d1");
  });
});

describe("the two questions Manage asks", () => {
  async function openManage() {
    const view = renderCard();
    await view.user.click(screen.getByRole("button", { name: "Manage" }));
    return view;
  }

  it("asks before making a new key, and then goes to the key step", async () => {
    const { user } = await openManage();

    await user.click(
      screen.getByRole("button", { name: /Create a new recovery key/ }),
    );
    const sheet = await screen.findByRole("alertdialog");
    expect(
      within(sheet).getByText("Create a new recovery key?"),
    ).toBeInTheDocument();
    expect(router.push).not.toHaveBeenCalled();

    await user.click(
      within(sheet).getByRole("button", { name: "Create a new key" }),
    );

    expect(router.push).toHaveBeenCalledWith(
      "/settings/backup/setup?step=key&rotate=1",
    );
  });

  it("keeps the current key when asked to", async () => {
    const { user } = await openManage();
    await user.click(
      screen.getByRole("button", { name: /Create a new recovery key/ }),
    );

    await user.click(
      await screen.findByRole("button", { name: "Keep my current key" }),
    );

    expect(router.push).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
  });

  it("says what stopping removes and what it leaves, then stops", async () => {
    const { user } = await openManage();

    await user.click(screen.getByRole("button", { name: "Stop backing up…" }));
    const sheet = await screen.findByRole("alertdialog");

    expect(
      within(sheet).getByText("Stop backing up to Google Drive?"),
    ).toBeInTheDocument();
    expect(
      within(sheet).getByText("Removed from this server"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText("The schedule.")).toBeInTheDocument();
    expect(within(sheet).getByText("Stays where it is")).toBeInTheDocument();
    expect(
      within(sheet).getByText(
        "Every backup already in Google Drive. Balancia does not delete them.",
      ),
    ).toBeInTheDocument();
    expect(remove).not.toHaveBeenCalled();

    await user.click(
      within(sheet).getByRole("button", { name: "Stop backing up" }),
    );

    await waitFor(() => expect(remove).toHaveBeenCalledWith("d1"));
    await waitFor(() => expect(router.refresh).toHaveBeenCalled());
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it("keeps backing up when asked to, and removes nothing", async () => {
    const { user } = await openManage();
    await user.click(screen.getByRole("button", { name: "Stop backing up…" }));

    await user.click(
      await screen.findByRole("button", { name: "Keep backing up" }),
    );

    expect(remove).not.toHaveBeenCalled();
  });

  it("stays on the sheet and says so when stopping is refused", async () => {
    remove.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "notFound", detail: "" },
    });
    const { user } = await openManage();
    await user.click(screen.getByRole("button", { name: "Stop backing up…" }));

    await user.click(
      await screen.findByRole("button", { name: "Stop backing up" }),
    );

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

describe("in French", () => {
  it("is written from the French catalogue, with no key showing through", async () => {
    const view = renderWithIntl(
      <DestinationCard
        destination={destination({
          includeReceipts: true,
          latestSuccess: run({ receiptsPending: 12 }),
        })}
        runs={[run()]}
        groups={GROUPS}
        keyFingerprint="9f3a07c2"
        now={NOW}
      />,
      { locale: "fr", area: "backup" },
    );

    expect(
      screen.getByRole("button", { name: fr.cloudBackup.overview.now }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("switch", { name: fr.cloudBackup.overview.auto }),
    ).toBeInTheDocument();
    expect(view.container.textContent).not.toMatch(/\b(overview|schedule)\./);

    await userEvent
      .setup()
      .click(
        screen.getByRole("button", { name: fr.cloudBackup.overview.manage }),
      );
    expect(view.container.textContent).not.toMatch(
      /\b(overview|schedule|what|remove|rotate)\.[a-z]/i,
    );
  });
});
