import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import {
  facts,
  group,
  GROUPS,
  WizardHarness,
} from "../../../../tests/helpers/setup-wizard";
import type { SetupGroup } from "./types";

/**
 * Step 4: what goes, how often, and the receipts.
 *
 * The step ends in the one irreversible-feeling button of the flow, so what the
 * tests pin down is what that button sends — for each way a destination can
 * have been connected — and what the screen does when the server says no: it
 * says why, in words, and keeps everything the person chose.
 */

const { router, estimate, finishSetup, createDestination, testAction } =
  vi.hoisted(() => ({
    router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
    estimate: vi.fn(),
    finishSetup: vi.fn(),
    createDestination: vi.fn(),
    testAction: vi.fn(),
  }));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/modules/backup/actions", () => ({
  estimateReceiptsAction: estimate,
  finishSetupAction: finishSetup,
  createDestinationAction: createDestination,
  testDestinationAction: testAction,
  saveRecoveryKeyAction: vi.fn(),
  removeDestinationAction: vi.fn(),
}));

const PENDING = {
  id: "p1",
  provider: "google_drive",
  label: "Google Drive · ada@example.com",
} as const;

const WHAT =
  "/settings/backup/setup?step=what&provider=google_drive&connected=p1";

const DONE = { ok: true, data: { ok: true, value: { id: "d9" } } };

function renderWhat(
  options: {
    groups?: readonly SetupGroup[];
    current?: ReturnType<typeof facts>;
    url?: string;
  } = {},
) {
  const view = renderWithIntl(
    <WizardHarness
      facts={options.current ?? facts({ pending: PENDING })}
      ownedGroups={options.groups ?? GROUPS}
      url={options.url ?? WHAT}
      router={router}
    />,
  );
  return { ...view, user: userEvent.setup() };
}

const finishButton = () =>
  screen.getByRole("button", { name: "Start backing up" });
const rowFor = (name: string) =>
  screen.getByRole("checkbox", { name: new RegExp(name) });
const receipts = () =>
  screen.getByRole("switch", { name: /Also back up receipts/ });

describe("WhatStep", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    estimate.mockReset().mockResolvedValue({
      ok: true,
      data: { count: 12, bytes: 38_000_000 },
    });
    finishSetup.mockReset().mockResolvedValue(DONE);
    createDestination.mockReset().mockResolvedValue(DONE);
    testAction.mockReset().mockResolvedValue({
      ok: true,
      data: { ok: true, value: null },
    });
  });

  describe("the groups", () => {
    it("lists the groups the person owns, every one of them ticked", () => {
      renderWhat();

      for (const { name } of GROUPS) expect(rowFor(name)).toBeChecked();
      expect(screen.getByText("3 of 3 groups")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Groups where you are only a member are not listed. Only a group's owner can back it up.",
        ),
      ).toBeInTheDocument();
    });

    it("says how many people are in each, and when it last changed", () => {
      renderWhat();

      const lisbon = rowFor("Lisbon, March").closest("label") as HTMLElement;
      expect(lisbon).toHaveTextContent("4 members");
      expect(lisbon).toHaveTextContent(/changed .*2026/);
      // A group nothing has happened in has no date to give.
      const ski = rowFor("Ski week").closest("label") as HTMLElement;
      expect(ski).toHaveTextContent("6 members");
      expect(ski).not.toHaveTextContent("changed");
    });

    it("counts as the ticks change", async () => {
      const { user } = renderWhat();

      await user.click(rowFor("Flat"));

      expect(rowFor("Flat")).not.toBeChecked();
      expect(screen.getByText("2 of 3 groups")).toBeInTheDocument();
      expect(finishButton()).toBeEnabled();
    });

    it("will not finish with nothing ticked, and says why", async () => {
      const { user } = renderWhat();

      for (const { name } of GROUPS) await user.click(rowFor(name));

      expect(finishButton()).toBeDisabled();
      expect(
        screen.getByText("Tick at least one group to continue."),
      ).toBeInTheDocument();
    });

    it("shows five and then the rest when asked", async () => {
      const many = Array.from({ length: 8 }, (_, index) =>
        group(`m${index}`, `Group ${index + 1}`),
      );
      const { user } = renderWhat({ groups: many });

      expect(screen.getAllByRole("checkbox")).toHaveLength(5);
      await user.click(
        screen.getByRole("button", { name: "Show all 8 groups" }),
      );

      expect(screen.getAllByRole("checkbox")).toHaveLength(8);
      expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
      expect(screen.getByText("8 of 8 groups")).toBeInTheDocument();
    });

    it("offers no 'show all' to five or fewer", () => {
      renderWhat();
      expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    });

    it("keeps a tick on a group that is on the list but not shown yet", async () => {
      const many = Array.from({ length: 7 }, (_, index) =>
        group(`m${index}`, `Group ${index + 1}`),
      );
      const { user } = renderWhat({ groups: many });
      await user.click(
        screen.getByRole("button", { name: "Show all 7 groups" }),
      );
      await user.click(rowFor("Group 7"));

      await user.click(finishButton());

      await waitFor(() => expect(finishSetup).toHaveBeenCalled());
      expect(finishSetup.mock.calls[0][0].excludedGroupIds).toEqual(["m6"]);
    });

    describe("when the person owns no group", () => {
      it("says there is nothing to back up, and has nothing to finish", () => {
        renderWhat({ groups: [] });

        expect(screen.getByText("No group to back up")).toBeInTheDocument();
        expect(
          screen.getByText(
            "You don't own a group yet. Only a group's owner can back it up.",
          ),
        ).toBeInTheDocument();
        expect(finishButton()).toBeDisabled();
        expect(screen.queryByRole("checkbox")).toBeNull();
        expect(screen.queryByRole("switch")).toBeNull();
        // And does not tell somebody to tick what is not there.
        expect(
          screen.queryByText("Tick at least one group to continue."),
        ).toBeNull();
      });
    });
  });

  describe("the schedule", () => {
    it("starts on daily and keeping ten", () => {
      renderWhat();

      expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      const keep = within(
        screen.getByRole("group", { name: "Backups to keep" }),
      );
      expect(keep.getAllByRole("button").map((b) => b.textContent)).toEqual([
        "5",
        "10",
        "20",
        "30",
      ]);
      expect(keep.getByRole("button", { name: "10" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    it("moves with a press and stays moved", async () => {
      const { user } = renderWhat();

      await user.click(screen.getByRole("button", { name: "Weekly" }));
      await user.click(screen.getByRole("button", { name: "30" }));

      expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "Daily" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
      expect(screen.getByRole("button", { name: "30" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "10" })).toHaveAttribute(
        "aria-pressed",
        "false",
      );
    });

    it("says what happens to the older ones", () => {
      renderWhat();
      expect(
        screen.getByText(
          "Older backups are removed from your cloud. Receipts are never removed.",
        ),
      ).toBeInTheDocument();
    });
  });

  describe("receipts", () => {
    it("are off, with the cost spelled out beside the switch all the same", () => {
      renderWhat();

      expect(receipts()).not.toBeChecked();
      expect(screen.getByText("Off by default.")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Receipts are bigger than your data. They can use up your cloud storage and bandwidth.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          "They are encrypted the same way, sent once, and never deleted by Balancia.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /Balancia's import restores expenses, not receipt files/,
        ),
      ).toBeInTheDocument();
      expect(estimate).not.toHaveBeenCalled();
    });

    it("keeps the disclaimer when they are switched on", async () => {
      const { user } = renderWhat();

      await user.click(receipts());

      expect(receipts()).toBeChecked();
      expect(screen.queryByText("Off by default.")).toBeNull();
      expect(
        screen.getByText(/Receipts are bigger than your data/),
      ).toBeInTheDocument();
    });

    it("estimates once they are on, for every group that is ticked", async () => {
      const { user } = renderWhat();

      await user.click(receipts());

      expect(
        await screen.findByText("About 38 MB of receipts across 3 groups"),
      ).toBeInTheDocument();
      expect(estimate).toHaveBeenCalledExactlyOnceWith([]);
      expect(
        screen.queryByText("That is a lot for a free cloud plan."),
      ).toBeNull();
    });

    it("asks again, with the groups left out, when the ticks change", async () => {
      const { user } = renderWhat();
      await user.click(receipts());
      await screen.findByText(/About 38 MB/);
      estimate.mockResolvedValue({
        ok: true,
        data: { count: 4, bytes: 9_500_000 },
      });

      await user.click(rowFor("Flat"));

      expect(
        await screen.findByText("About 9.5 MB of receipts across 2 groups"),
      ).toBeInTheDocument();
      expect(estimate).toHaveBeenLastCalledWith(["g2"]);
    });

    it("waits for the ticks to settle before it asks", async () => {
      const { user } = renderWhat();
      await user.click(receipts());
      await screen.findByText(/About 38 MB/);
      estimate.mockClear();

      await user.click(rowFor("Flat"));
      await user.click(rowFor("Ski week"));
      await user.click(rowFor("Flat"));

      await waitFor(() => expect(estimate).toHaveBeenCalled());
      // One question, about the ticks as they ended up.
      expect(estimate).toHaveBeenCalledExactlyOnceWith(["g3"]);
    });

    it("throws away an answer to a question that is no longer the one asked", async () => {
      const { user } = renderWhat();
      let answerFirst!: (value: unknown) => void;
      estimate.mockReturnValueOnce(
        new Promise((resolve) => (answerFirst = resolve)),
      );
      await user.click(receipts());
      await waitFor(() => expect(estimate).toHaveBeenCalledTimes(1));

      // The ticks move on while that is still out.
      estimate.mockResolvedValue({
        ok: true,
        data: { count: 2, bytes: 5_000_000 },
      });
      await user.click(rowFor("Flat"));
      expect(
        await screen.findByText("About 5 MB of receipts across 2 groups"),
      ).toBeInTheDocument();

      // And the slow, stale answer arrives last.
      answerFirst({ ok: true, data: { count: 99, bytes: 99_000_000 } });
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(
        screen.getByText("About 5 MB of receipts across 2 groups"),
      ).toBeInTheDocument();
      expect(screen.queryByText(/99 MB/)).toBeNull();
    });

    it("adds a quiet line when it is a lot", async () => {
      estimate.mockResolvedValue({
        ok: true,
        data: { count: 4000, bytes: 2_500_000_000 },
      });
      const { user } = renderWhat();

      await user.click(receipts());

      expect(
        await screen.findByText("About 2.5 GB of receipts across 3 groups"),
      ).toBeInTheDocument();
      expect(
        screen.getByText("That is a lot for a free cloud plan."),
      ).toBeInTheDocument();
    });

    it("stops estimating when they are switched off again", async () => {
      const { user } = renderWhat();
      await user.click(receipts());
      await screen.findByText(/About 38 MB/);

      await user.click(receipts());

      expect(screen.queryByText(/About 38 MB/)).toBeNull();
      expect(screen.getByText("Off by default.")).toBeInTheDocument();
    });

    it("says nothing when the estimate could not be made", async () => {
      estimate.mockResolvedValue({ ok: false, error: "nope" });
      const { user } = renderWhat();

      await user.click(receipts());
      await waitFor(() => expect(estimate).toHaveBeenCalled());

      expect(screen.queryByText(/About/)).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("does not ask for an estimate of nothing", async () => {
      const { user } = renderWhat();
      for (const { name } of GROUPS) await user.click(rowFor(name));
      estimate.mockClear();

      await user.click(receipts());
      await new Promise((resolve) => setTimeout(resolve, 400));

      expect(estimate).not.toHaveBeenCalled();
    });
  });

  describe("finishing a connection made by a trip to the provider", () => {
    it("finishes the connection that came back, with the defaults", async () => {
      const { user } = renderWhat();

      await user.click(finishButton());

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith("/settings/backup"),
      );
      expect(finishSetup).toHaveBeenCalledExactlyOnceWith({
        id: "p1",
        frequency: "daily",
        keepLast: 10,
        excludedGroupIds: [],
        includeReceipts: false,
      });
      expect(createDestination).not.toHaveBeenCalled();
      expect(router.refresh).toHaveBeenCalled();
    });

    it("sends what was chosen", async () => {
      const { user } = renderWhat();
      await user.click(rowFor("Flat"));
      await user.click(screen.getByRole("button", { name: "Weekly" }));
      await user.click(screen.getByRole("button", { name: "20" }));
      await user.click(receipts());

      await user.click(finishButton());

      await waitFor(() => expect(finishSetup).toHaveBeenCalled());
      expect(finishSetup).toHaveBeenCalledWith({
        id: "p1",
        frequency: "weekly",
        keepLast: 20,
        excludedGroupIds: ["g2"],
        includeReceipts: true,
      });
    });

    it("says it is working, and cannot be pressed twice", async () => {
      let answer!: (value: unknown) => void;
      finishSetup.mockReturnValue(new Promise((resolve) => (answer = resolve)));
      const { user } = renderWhat();

      await user.click(finishButton());
      await user.click(finishButton());

      expect(finishButton()).toBeDisabled();
      expect(finishButton()).toHaveAttribute("aria-busy", "true");
      expect(finishSetup).toHaveBeenCalledOnce();

      answer(DONE);
      await waitFor(() => expect(router.push).toHaveBeenCalled());
    });

    it("says the first backup runs at once", () => {
      renderWhat();
      expect(
        screen.getByText("The first backup runs right away."),
      ).toBeInTheDocument();
    });

    describe("when the server says no", () => {
      async function refuse(code: string) {
        finishSetup.mockResolvedValue({
          ok: true,
          data: { ok: false, code, detail: "" },
        });
        const view = renderWhat();
        await view.user.click(rowFor("Flat"));
        await view.user.click(screen.getByRole("button", { name: "Weekly" }));
        await view.user.click(finishButton());
        return view;
      }

      it("gives the sentence for the code, above the button", async () => {
        await refuse("quota");

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent(
          "Not enough space in your Google Drive.",
        );
        expect(alert).toHaveTextContent(
          "Free some space or choose a bigger plan",
        );
        expect(router.push).not.toHaveBeenCalled();
      });

      it("keeps everything that was chosen, and the button ready", async () => {
        await refuse("quota");
        await screen.findByRole("alert");

        expect(rowFor("Flat")).not.toBeChecked();
        expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
          "aria-pressed",
          "true",
        );
        expect(finishButton()).toBeEnabled();
      });

      it.each([
        ["reconnect", "Access was revoked or has expired."],
        ["forbidden", "The account is not allowed to write there."],
        ["unreachable", "Google Drive could not be reached."],
        ["rate_limited", "Google Drive asked Balancia to slow down."],
        ["noKey", "There is no recovery key, so nothing can be encrypted."],
        ["no_key", "There is no recovery key, so nothing can be encrypted."],
        ["notFound", "The folder or bucket could not be found."],
        [
          "unavailable",
          "Cloud backup is not installed on this server. Ask your administrator.",
        ],
      ])("words '%s'", async (code, sentence) => {
        await refuse(code);
        expect(await screen.findByRole("alert")).toHaveTextContent(sentence);
      });

      it.each(["tooMany", "invalidDetails", "invalidKey", "something-new"])(
        "has a plain sentence for '%s', which nothing more specific is written for",
        async (code) => {
          await refuse(code);
          expect(await screen.findByRole("alert")).toBeInTheDocument();
          expect(screen.getByRole("alert").textContent?.length).toBeGreaterThan(
            5,
          );
          expect(router.push).not.toHaveBeenCalled();
        },
      );

      it("speaks of a fault in the server's own words", async () => {
        finishSetup.mockResolvedValue({
          ok: false,
          error: "Something broke on the server.",
        });
        const { user } = renderWhat();

        await user.click(finishButton());

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Something broke on the server.",
        );
        expect(finishButton()).toBeEnabled();
      });

      it("copes with an action that throws", async () => {
        finishSetup.mockRejectedValue(new Error("network"));
        const { user } = renderWhat();

        await user.click(finishButton());

        expect(await screen.findByRole("alert")).toHaveTextContent(
          "Something went wrong.",
        );
        expect(finishButton()).toBeEnabled();
      });

      it("clears the sentence when the person tries again", async () => {
        const { user } = await refuse("quota");
        await screen.findByRole("alert");
        finishSetup.mockResolvedValue(DONE);

        await user.click(finishButton());

        await waitFor(() =>
          expect(router.push).toHaveBeenCalledWith("/settings/backup"),
        );
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });

  describe("finishing a connection made by typing", () => {
    async function connectBucket(user: ReturnType<typeof userEvent.setup>) {
      await user.click(screen.getByRole("radio", { name: "S3-compatible" }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.type(await screen.findByLabelText("Bucket"), "family-backups");
      await user.type(screen.getByLabelText("Access key"), "AKIAEXAMPLE");
      await user.type(screen.getByLabelText("Secret key"), "s3cr3t-value");
      await user.click(screen.getByRole("button", { name: "Test connection" }));
      await screen.findByText("Connected");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("heading", { name: "Choose what to back up" });
    }

    it("creates the destination with the details that passed, and the choices", async () => {
      const { user } = renderWhat({
        current: facts(),
        url: "/settings/backup/setup?step=where",
      });
      await connectBucket(user);
      await user.click(rowFor("Ski week"));
      await user.click(screen.getByRole("button", { name: "Weekly" }));

      await user.click(finishButton());

      await waitFor(() =>
        expect(router.push).toHaveBeenLastCalledWith("/settings/backup"),
      );
      expect(createDestination).toHaveBeenCalledExactlyOnceWith({
        provider: "s3",
        credentials: {
          endpoint: "",
          region: "",
          flavour: "AWS",
          bucket: "family-backups",
          prefix: "",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "s3cr3t-value",
          pathStyle: false,
        },
        frequency: "weekly",
        keepLast: 10,
        excludedGroupIds: ["g3"],
        includeReceipts: false,
      });
      expect(finishSetup).not.toHaveBeenCalled();
    });

    it("keeps the typed details when a refusal sends the person back a step", async () => {
      createDestination.mockResolvedValue({
        ok: true,
        data: { ok: false, code: "forbidden", detail: "" },
      });
      const { user } = renderWhat({
        current: facts(),
        url: "/settings/backup/setup?step=where",
      });
      await connectBucket(user);

      await user.click(finishButton());
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "The account is not allowed to write there.",
      );

      await user.click(screen.getByRole("button", { name: "Back" }));
      expect(await screen.findByLabelText("Bucket")).toHaveValue(
        "family-backups",
      );
      expect(screen.getByText("Connected")).toBeInTheDocument();
    });
  });

  describe("changing where to back up", () => {
    const REPLACED = {
      id: "d1",
      provider: "dropbox",
      frequency: "weekly",
      keepLast: 20,
      excludedGroupIds: ["g2", "gone"],
      includeReceipts: true,
    } as const;

    function renderReplacing() {
      return renderWhat({
        current: facts({ destinations: [REPLACED], pending: PENDING }),
        // The trip does not bring `replace` back; the page infers it.
        url: WHAT,
      });
    }

    it("starts from what the old destination was doing", async () => {
      renderReplacing();

      expect(rowFor("Flat")).not.toBeChecked();
      expect(rowFor("Lisbon, March")).toBeChecked();
      expect(screen.getByRole("button", { name: "Weekly" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(screen.getByRole("button", { name: "20" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      expect(receipts()).toBeChecked();
      // And the estimate is for those, not for every group there is.
      await screen.findByText(/About 38 MB/);
      expect(estimate).toHaveBeenCalledWith(["g2"]);
    });

    it("shows a number of backups to keep that is not one of the four, and keeps it chosen", async () => {
      const { user } = renderWhat({
        current: facts({
          destinations: [{ ...REPLACED, keepLast: 15 }],
          pending: PENDING,
        }),
      });

      const keep = within(
        screen.getByRole("group", { name: "Backups to keep" }),
      );
      expect(keep.getAllByRole("button").map((b) => b.textContent)).toEqual([
        "5",
        "10",
        "15",
        "20",
        "30",
      ]);
      expect(keep.getByRole("button", { name: "15" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );

      await user.click(finishButton());
      await waitFor(() => expect(finishSetup).toHaveBeenCalled());
      expect(finishSetup.mock.calls[0][0].keepLast).toBe(15);
    });

    it("says which destination the new one replaces", async () => {
      const { user } = renderReplacing();

      await user.click(finishButton());

      await waitFor(() => expect(finishSetup).toHaveBeenCalled());
      expect(finishSetup).toHaveBeenCalledWith({
        id: "p1",
        frequency: "weekly",
        keepLast: 20,
        // The group that is no longer theirs is not carried along.
        excludedGroupIds: ["g2"],
        includeReceipts: true,
        replaces: "d1",
      });
    });

    it("says it for a typed connection too", async () => {
      const { user } = renderWhat({
        current: facts({ destinations: [REPLACED] }),
        url: "/settings/backup/setup?step=where&replace=d1",
      });
      await user.click(screen.getByRole("radio", { name: "S3-compatible" }));
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await user.type(await screen.findByLabelText("Bucket"), "family-backups");
      await user.type(screen.getByLabelText("Access key"), "AKIAEXAMPLE");
      await user.type(screen.getByLabelText("Secret key"), "s3cr3t-value");
      await user.click(screen.getByRole("button", { name: "Test connection" }));
      await screen.findByText("Connected");
      await user.click(screen.getByRole("button", { name: "Continue" }));
      await screen.findByRole("heading", { name: "Choose what to back up" });

      await user.click(finishButton());

      await waitFor(() => expect(createDestination).toHaveBeenCalled());
      expect(createDestination).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "s3", replaces: "d1" }),
      );
    });
  });

  it("asks for nothing the page does not already know when it is first drawn", () => {
    renderWhat();
    expect(testAction).not.toHaveBeenCalled();
    expect(estimate).not.toHaveBeenCalled();
    expect(finishSetup).not.toHaveBeenCalled();
  });
});
