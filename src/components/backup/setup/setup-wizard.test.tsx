import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { facts, WizardHarness } from "../../../../tests/helpers/setup-wizard";

/**
 * The wizard as a whole: its chrome, and the draft's journey through the steps.
 *
 * Each step has a file of its own for what it does; this one is about what
 * only the shell can do — number the steps, keep the draft while the address
 * changes under it, take focus to a new step, drop a connection nobody
 * finished, and refuse to stand on a step whose details have gone.
 */

const { router, saveKey, createKey, removeDestination } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  saveKey: vi.fn(),
  createKey: vi.fn(),
  removeDestination: vi.fn(),
}));

const BODY = "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7LQPZRY9X8GF2TVDW0S3JN54KHCE";

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/modules/backup/age", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/backup/age")>()),
  createRecoveryKey: createKey,
}));
vi.mock("@/modules/backup/actions", () => ({
  saveRecoveryKeyAction: saveKey,
  testDestinationAction: vi.fn(),
  createDestinationAction: vi.fn(),
  finishSetupAction: vi.fn(),
  estimateReceiptsAction: vi.fn(),
  removeDestinationAction: removeDestination,
}));

const PENDING = {
  id: "p1",
  provider: "google_drive",
  label: "Google Drive · ada@example.com",
} as const;

const DROPBOX = {
  id: "d1",
  provider: "dropbox",
  frequency: "weekly",
  keepLast: 20,
  excludedGroupIds: [],
  includeReceipts: false,
} as const;

function renderAt(url: string, current = facts()) {
  const view = renderWithIntl(
    <WizardHarness facts={current} url={url} router={router} />,
  );
  return { ...view, user: userEvent.setup() };
}

const proceed = () => screen.getByRole("button", { name: "Continue" });

describe("SetupWizard", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    saveKey.mockReset().mockResolvedValue({
      ok: true,
      data: { ok: true, value: { fingerprint: "abcd1234" } },
    });
    createKey.mockReset().mockResolvedValue({
      identity: `AGE-SECRET-KEY-1${BODY}`,
      recipient: "age1fixedrecipientforthetests",
    });
    removeDestination.mockReset().mockResolvedValue({
      ok: true,
      data: { ok: true, value: null },
    });
  });

  describe("the step strip", () => {
    it("counts four steps while there is a key to make", async () => {
      renderAt("/settings/backup/setup", facts({ hasKey: false }));
      await screen.findByText("AGE-SECRET-KEY-1");

      expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
      expect(screen.getByText("Recovery key")).toBeInTheDocument();
      expect(
        screen.getByRole("progressbar", { name: "Step 1 of 4" }),
      ).toHaveAttribute("aria-valuenow", "25");
    });

    it("counts three once the key is there, and starts at the second", () => {
      renderAt("/settings/backup/setup?step=key");

      expect(screen.getByText("Step 1 of 3")).toBeInTheDocument();
      expect(screen.getByText("Where to back up")).toBeInTheDocument();
      expect(screen.queryByText("Create your recovery key")).toBeNull();
    });

    it("is not drawn at all for a new key", async () => {
      renderAt(
        "/settings/backup/setup?rotate=1",
        facts({ destinations: [DROPBOX] }),
      );
      await screen.findByText("AGE-SECRET-KEY-1");

      expect(screen.queryByText(/^Step \d of \d$/)).toBeNull();
      expect(screen.queryByRole("progressbar")).toBeNull();
      expect(screen.getByText("Your new recovery key")).toBeInTheDocument();
    });
  });

  describe("a new key for an existing setup", () => {
    async function rotate() {
      const view = renderAt(
        "/settings/backup/setup?rotate=1",
        facts({ destinations: [DROPBOX] }),
      );
      await screen.findByText("AGE-SECRET-KEY-1");
      await view.user.click(
        screen.getByRole("checkbox", { name: /I have saved my recovery key/ }),
      );
      await view.user.type(
        screen.getByLabelText("Type the last 6 characters"),
        "54KHCE",
      );
      return view;
    }

    it("saves it and goes back to the overview", async () => {
      const { user } = await rotate();

      await user.click(proceed());

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith("/settings/backup"),
      );
      expect(router.refresh).toHaveBeenCalled();
      expect(saveKey).toHaveBeenCalledWith("age1fixedrecipientforthetests");
    });

    it("goes back to the overview without saving when it is cancelled", async () => {
      const { user } = await rotate();

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith("/settings/backup"),
      );
      expect(saveKey).not.toHaveBeenCalled();
    });
  });

  describe("from the key to a provider", () => {
    it("carries on to 'where' once the key is saved, and keeps counting four", async () => {
      const current = facts({ hasKey: false });
      // What the server will say the next time it is asked.
      saveKey.mockImplementation(async () => {
        Object.assign(current, { hasKey: true });
        return { ok: true, data: { ok: true, value: { fingerprint: "ab" } } };
      });
      const { user } = renderAt("/settings/backup/setup", current);
      await screen.findByText("AGE-SECRET-KEY-1");
      await user.click(
        screen.getByRole("checkbox", { name: /I have saved my recovery key/ }),
      );
      await user.type(
        screen.getByLabelText("Type the last 6 characters"),
        "54KHCE",
      );

      await user.click(proceed());

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith(
          "/settings/backup/setup?step=where",
        ),
      );
      expect(
        await screen.findByText("Choose where to back up"),
      ).toBeInTheDocument();
      expect(screen.getByText("Step 2 of 4")).toBeInTheDocument();
      // The private half went with the step: nothing of it is left in the page.
      expect(screen.queryByText("AGE-SECRET-KEY-1")).toBeNull();
    });
  });

  describe("footer", () => {
    it("offers Cancel on the first step and Back after it", async () => {
      const { user } = renderAt("/settings/backup/setup");

      expect(
        screen.getByRole("button", { name: "Cancel" }),
      ).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Back" })).toBeNull();

      await user.click(screen.getByRole("radio", { name: "S3-compatible" }));
      await user.click(proceed());

      expect(
        await screen.findByRole("heading", { name: "Connect S3" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    });

    it("leaves for the overview on Cancel", async () => {
      const { user } = renderAt("/settings/backup/setup");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith("/settings/backup"),
      );
      expect(removeDestination).not.toHaveBeenCalled();
    });

    it("drops a connection nobody finished when it is cancelled", async () => {
      const { user } = renderAt(
        "/settings/backup/setup?step=connect&provider=google_drive&connected=p1",
        facts({ pending: PENDING }),
      );
      await user.click(screen.getByRole("button", { name: "Back" }));
      await screen.findByText("Choose where to back up");

      await user.click(screen.getByRole("button", { name: "Cancel" }));

      await waitFor(() =>
        expect(router.push).toHaveBeenLastCalledWith("/settings/backup"),
      );
      expect(removeDestination).toHaveBeenCalledExactlyOnceWith("p1");
    });
  });

  describe("the draft", () => {
    it("survives going to the next step and coming back", async () => {
      const { user } = renderAt("/settings/backup/setup");

      await user.click(screen.getByRole("radio", { name: "S3-compatible" }));
      await user.click(proceed());
      await user.type(await screen.findByLabelText("Bucket"), "family-backups");

      await user.click(screen.getByRole("button", { name: "Back" }));
      // Same provider, still chosen.
      expect(
        await screen.findByRole("radio", { name: "S3-compatible" }),
      ).toBeChecked();

      await user.click(proceed());
      expect(await screen.findByLabelText("Bucket")).toHaveValue(
        "family-backups",
      );
    });

    it("puts the provider in the address and nothing a person typed", async () => {
      const { user } = renderAt("/settings/backup/setup");

      await user.click(screen.getByRole("radio", { name: "S3-compatible" }));
      await user.click(proceed());
      await user.type(await screen.findByLabelText("Bucket"), "family-backups");
      await user.type(screen.getByLabelText("Access key"), "AKIAEXAMPLE");
      await user.type(screen.getByLabelText("Secret key"), "s3cr3t-value");
      await user.click(screen.getByRole("button", { name: "Back" }));

      for (const [url] of [
        ...router.push.mock.calls,
        ...router.replace.mock.calls,
      ]) {
        expect(url).not.toContain("family-backups");
        expect(url).not.toContain("AKIAEXAMPLE");
        expect(url).not.toContain("s3cr3t-value");
      }
    });

    it("moves focus to the heading of the step that has appeared", async () => {
      const { user } = renderAt("/settings/backup/setup");
      await user.click(screen.getByRole("radio", { name: "Google Drive" }));

      await user.click(proceed());

      const heading = await screen.findByRole("heading", {
        name: "Connect Google Drive",
      });
      await waitFor(() => expect(heading).toHaveFocus());
    });
  });

  describe("an address it cannot honour", () => {
    it("shows step 3 and asks for it, when step 4 is asked for with nothing tested", async () => {
      renderAt("/settings/backup/setup?step=what&provider=s3");

      expect(
        await screen.findByRole("heading", { name: "Connect S3" }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("heading", { name: "Choose what to back up" }),
      ).toBeNull();
      await waitFor(() =>
        expect(router.replace).toHaveBeenCalledWith(
          "/settings/backup/setup?step=connect&provider=s3",
        ),
      );
    });

    it("sends an address for somebody else's destination to the not-found screen", () => {
      renderAt(
        "/settings/backup/setup?replace=nobody",
        facts({ destinations: [DROPBOX] }),
      );
      expect(screen.getByTestId("resolution")).toHaveTextContent("notFound");
    });

    it("sends somebody who has a destination to the overview", () => {
      renderAt("/settings/backup/setup", facts({ destinations: [DROPBOX] }));
      expect(screen.getByTestId("resolution")).toHaveTextContent("redirect");
    });
  });

  describe("changing where to back up", () => {
    it("says what it takes over from", () => {
      renderAt(
        "/settings/backup/setup?step=where&replace=d1",
        facts({ destinations: [DROPBOX] }),
      );

      expect(
        screen.getByText(
          "The new place takes over from Dropbox. Backups already there stay where they are.",
        ),
      ).toBeInTheDocument();
    });

    it("keeps the replaced destination's id in the address as the steps go by", async () => {
      const { user } = renderAt(
        "/settings/backup/setup?step=where&replace=d1",
        facts({ destinations: [DROPBOX] }),
      );

      await user.click(screen.getByRole("radio", { name: "Google Drive" }));
      await user.click(proceed());

      await waitFor(() =>
        expect(router.push).toHaveBeenCalledWith(
          "/settings/backup/setup?step=connect&provider=google_drive&replace=d1",
        ),
      );
    });
  });
});
