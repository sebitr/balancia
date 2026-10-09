import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { facts, WizardHarness } from "../../../../tests/helpers/setup-wizard";

/**
 * Step 3, in each of the shapes it takes.
 *
 * Two promises matter more than the rest. What is sent to be tested is exactly
 * what the form holds, shaped as the server's schema wants it. And Continue is
 * a claim that this connection works, so it outlives nothing: a failed test
 * never unlocks it, and a change after a pass takes it away again.
 */

const { router, testAction } = vi.hoisted(() => ({
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
  testAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/modules/backup/actions", () => ({
  testDestinationAction: testAction,
  saveRecoveryKeyAction: vi.fn(),
  createDestinationAction: vi.fn(),
  finishSetupAction: vi.fn(),
  estimateReceiptsAction: vi.fn(),
  removeDestinationAction: vi.fn(),
}));

const PENDING = {
  id: "p1",
  provider: "google_drive",
  label: "Google Drive · ada@example.com",
} as const;

const PASS = { ok: true, data: { ok: true, value: null } };

function fail(code: string, detail = "") {
  return { ok: true, data: { ok: false, code, detail } };
}

function renderAt(url: string, current = facts()) {
  const view = renderWithIntl(
    <WizardHarness facts={current} url={url} router={router} />,
  );
  return { ...view, user: userEvent.setup() };
}

const proceed = () => screen.getByRole("button", { name: "Continue" });
const testButton = () =>
  screen.getByRole("button", { name: "Test connection" });

async function fillS3(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("Region"), "eu-central-1");
  await user.type(screen.getByLabelText("Bucket"), "family-backups");
  await user.type(screen.getByLabelText("Access key"), "AKIAEXAMPLE");
  await user.type(screen.getByLabelText("Secret key"), "s3cr3t-value");
}

describe("ConnectStep", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.replace.mockReset();
    router.refresh.mockReset();
    testAction.mockReset().mockResolvedValue(PASS);
  });

  describe("an account: Google Drive, Dropbox, OneDrive", () => {
    const BEFORE = "/settings/backup/setup?step=connect&provider=";

    it.each([
      ["google_drive", "Google Drive", "google"],
      ["dropbox", "Dropbox", "dropbox"],
      ["onedrive", "OneDrive", "microsoft"],
    ])(
      "goes to %s by a plain link and not by anything that could be prefetched or posted",
      (id, name, kind) => {
        renderAt(`${BEFORE}${id}`);

        const link = screen.getByRole("link", { name: `Connect to ${name}` });
        expect(link).toHaveAttribute("href", `/api/backup/oauth/${kind}/start`);
        expect(link.tagName).toBe("A");
        // Not a form: the page's CSP would stop the redirect to the provider.
        expect(document.querySelector("form")).toBeNull();
      },
    );

    it("explains the trip, says nothing is connected, and does not let Continue through", () => {
      renderAt(`${BEFORE}google_drive`);

      expect(
        screen.getByText(
          "You will go to Google Drive to allow access, then come straight back. There is nothing to type here.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByText("Not connected yet")).toBeInTheDocument();
      expect(proceed()).toBeDisabled();
      expect(
        screen.queryByRole("button", { name: "Test connection" }),
      ).toBeNull();
    });

    describe("back from the provider", () => {
      const RETURNED = `${BEFORE}google_drive&connected=p1`;

      it("says who connected, what Balancia can see and where it will write", () => {
        renderAt(RETURNED, facts({ pending: PENDING }));

        expect(
          screen.getByText("Connected to Google Drive as ada@example.com"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Balancia can only see the files it creates."),
        ).toBeInTheDocument();
        expect(
          screen.getByText("Backups go in a folder called Balancia Backups."),
        ).toBeInTheDocument();
        expect(screen.queryByText("Not connected yet")).toBeNull();
      });

      it("offers the same trip again for another account", () => {
        renderAt(RETURNED, facts({ pending: PENDING }));

        expect(
          screen.getByRole("link", { name: "Use a different account" }),
        ).toHaveAttribute("href", "/api/backup/oauth/google/start");
      });

      it("lets Continue through, and takes the connection with it", async () => {
        const { user } = renderAt(RETURNED, facts({ pending: PENDING }));

        await user.click(proceed());

        expect(router.push).toHaveBeenCalledWith(
          "/settings/backup/setup?step=what&provider=google_drive&connected=p1",
        );
        expect(
          await screen.findByRole("heading", {
            name: "Choose what to back up",
          }),
        ).toBeInTheDocument();
      });

      it("makes do when the provider gave no account name", () => {
        renderAt(
          RETURNED,
          facts({ pending: { ...PENDING, label: "Google Drive" } }),
        );
        expect(
          screen.getByText("Connected to Google Drive"),
        ).toBeInTheDocument();
      });
    });

    describe("an outcome the trip came back with", () => {
      const alert = () => screen.getByRole("alert");

      it("takes 'denied' as a plain no, and offers the same button again", () => {
        renderAt(`${BEFORE}google_drive&connect=denied`);

        expect(
          within(alert()).getByText("Access wasn't allowed"),
        ).toBeInTheDocument();
        expect(
          within(alert()).getByText(
            "Google Drive did not give Balancia access, so nothing is connected. You can try again.",
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByRole("link", { name: "Connect to Google Drive" }),
        ).toBeInTheDocument();
        expect(proceed()).toBeDisabled();
      });

      it.each([
        ["failed", "Something went wrong connecting to Dropbox. Try again."],
        [
          "expired",
          "That took too long, so it was stopped. Try connecting again.",
        ],
        [
          "unavailable",
          "Dropbox is not set up on this server. Ask your administrator.",
        ],
      ])("words '%s'", (code, sentence) => {
        renderAt(`${BEFORE}dropbox&connect=${code}`);
        expect(within(alert()).getByText(sentence)).toBeInTheDocument();
      });

      it("words a code the connection itself was refused with, and what to do", () => {
        renderAt(`${BEFORE}dropbox&connect=quota`);

        expect(
          within(alert()).getByText(/Not enough space in your Dropbox\./),
        ).toBeInTheDocument();
        expect(
          within(alert()).getByText(/Free some space or choose a bigger plan/),
        ).toBeInTheDocument();
      });

      it("ignores a word nobody here would have sent", () => {
        renderAt(`${BEFORE}dropbox&connect=%3Cscript%3E`);
        expect(screen.queryByRole("alert")).toBeNull();
      });
    });
  });

  describe("an S3-compatible bucket", () => {
    const URL = "/settings/backup/setup?step=connect&provider=s3";

    it("starts with the service, then the details, with the rest folded away", () => {
      renderAt(URL);

      expect(screen.getByLabelText("Service")).toHaveValue("aws");
      for (const label of ["Region", "Bucket", "Access key", "Secret key"]) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
      expect(screen.queryByLabelText("Folder in the bucket")).toBeNull();
      expect(
        screen.getByText(
          "Balancia keeps these on this server so it can sign in for you.",
        ),
      ).toBeInTheDocument();
    });

    it("lists the services it knows", () => {
      renderAt(URL);

      const names = within(screen.getByLabelText("Service"))
        .getAllByRole("option")
        .map((option) => option.textContent);
      expect(names).toEqual([
        "Amazon S3",
        "Backblaze B2",
        "Wasabi",
        "Cloudflare R2",
        "Infomaniak Swiss Backup",
        "MinIO",
        "Other",
      ]);
    });

    it("asks for no address for Amazon, whose own address is no address at all", async () => {
      const { user } = renderAt(URL);
      expect(screen.queryByLabelText("Server address")).toBeNull();

      await user.selectOptions(screen.getByLabelText("Service"), "Wasabi");
      expect(screen.getByLabelText("Server address")).toHaveAttribute(
        "placeholder",
        "s3.<region>.wasabisys.com",
      );
    });

    it("keeps Test connection off until the details are in", async () => {
      const { user } = renderAt(URL);
      expect(testButton()).toBeDisabled();

      await user.type(screen.getByLabelText("Bucket"), "family-backups");
      await user.type(screen.getByLabelText("Access key"), "AKIAEXAMPLE");
      expect(testButton()).toBeDisabled();

      await user.type(screen.getByLabelText("Secret key"), "s3cr3t-value");
      expect(testButton()).toBeEnabled();
    });

    it("tests exactly what was typed, shaped for Amazon", async () => {
      const { user } = renderAt(URL);
      await fillS3(user);

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledExactlyOnceWith({
        provider: "s3",
        credentials: {
          endpoint: "",
          region: "eu-central-1",
          flavour: "AWS",
          bucket: "family-backups",
          prefix: "",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "s3cr3t-value",
          pathStyle: false,
        },
      });
    });

    it("tests another service with its own flavour, and a scheme on its address", async () => {
      const { user } = renderAt(URL);
      await user.selectOptions(
        screen.getByLabelText("Service"),
        "Backblaze B2",
      );
      await user.type(
        screen.getByLabelText("Server address"),
        "s3.eu-central-003.backblazeb2.com",
      );
      await fillS3(user);

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledWith({
        provider: "s3",
        credentials: expect.objectContaining({
          endpoint: "https://s3.eu-central-003.backblazeb2.com",
          flavour: "Other",
        }),
      });
    });

    it("takes the folder and path-style addressing from More options", async () => {
      const { user } = renderAt(URL);
      await fillS3(user);

      await user.click(screen.getByRole("button", { name: "More options" }));
      await user.type(
        screen.getByLabelText("Folder in the bucket"),
        "balancia",
      );
      await user.click(
        screen.getByRole("checkbox", { name: /Use path-style addresses/ }),
      );
      await user.click(testButton());

      expect(testAction).toHaveBeenCalledWith({
        provider: "s3",
        credentials: expect.objectContaining({
          prefix: "balancia",
          pathStyle: true,
        }),
      });
    });

    it("keeps the secret key behind an eye", async () => {
      const { user } = renderAt(URL);
      const field = screen.getByLabelText("Secret key");
      await user.type(field, "s3cr3t-value");
      expect(field).toHaveAttribute("type", "password");

      await user.click(screen.getByRole("button", { name: "Show password" }));
      expect(field).toHaveAttribute("type", "text");
    });

    describe("while the test runs", () => {
      it("turns the fields and the button off and says what is happening", async () => {
        let finish!: (value: unknown) => void;
        testAction.mockReturnValue(
          new Promise((resolve) => (finish = resolve)),
        );
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        expect(await screen.findByText("Testing…")).toBeInTheDocument();
        expect(
          screen.getByText("Writing a small test file."),
        ).toBeInTheDocument();
        expect(testButton()).toBeDisabled();
        for (const label of ["Region", "Bucket", "Access key", "Secret key"]) {
          expect(screen.getByLabelText(label)).toBeDisabled();
        }
        expect(proceed()).toBeDisabled();

        finish(PASS);
        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(screen.getByLabelText("Bucket")).toBeEnabled();
      });
    });

    describe("when the test passes", () => {
      it("says so in place and lets Continue through", async () => {
        const { user } = renderAt(URL);
        await fillS3(user);
        expect(
          screen.getByText("Test the connection to continue."),
        ).toBeInTheDocument();

        await user.click(testButton());

        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Balancia wrote a small test file, found it again and deleted it.",
          ),
        ).toBeInTheDocument();
        expect(proceed()).toBeEnabled();
        expect(
          screen.queryByText("Test the connection to continue."),
        ).toBeNull();
      });

      it("announces the answer to somebody who is not looking at it", async () => {
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        const status = await screen.findByRole("status");
        expect(status).toHaveTextContent("Connected");
      });

      it("is taken back by the next change to any field", async () => {
        const { user } = renderAt(URL);
        await fillS3(user);
        await user.click(testButton());
        await screen.findByText("Connected");
        expect(proceed()).toBeEnabled();

        await user.type(screen.getByLabelText("Bucket"), "2");

        expect(proceed()).toBeDisabled();
        expect(screen.queryByText("Connected")).toBeNull();
        expect(
          screen.getByText("Test the connection to continue."),
        ).toBeInTheDocument();
      });

      it("is taken back by a change in More options too", async () => {
        const { user } = renderAt(URL);
        await fillS3(user);
        await user.click(screen.getByRole("button", { name: "More options" }));
        await user.click(testButton());
        await screen.findByText("Connected");

        await user.click(
          screen.getByRole("checkbox", { name: /Use path-style addresses/ }),
        );

        expect(proceed()).toBeDisabled();
      });

      it("moves on to the next step, with the provider and no secret in the address", async () => {
        const { user } = renderAt(URL);
        await fillS3(user);
        await user.click(testButton());
        await screen.findByText("Connected");

        await user.click(proceed());

        expect(router.push).toHaveBeenCalledWith(
          "/settings/backup/setup?step=what&provider=s3",
        );
      });
    });

    describe("when the test fails", () => {
      it("gives Balancia's sentence, what to do, and the provider's own words", async () => {
        testAction.mockResolvedValue(
          fail(
            "forbidden",
            "403 AccessDenied: the key cannot write to this bucket",
          ),
        );
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        expect(
          await screen.findByText("Could not connect"),
        ).toBeInTheDocument();
        expect(
          screen.getByText("The account is not allowed to write there."),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            "Check that this key may write to the bucket, then test again.",
          ),
        ).toBeInTheDocument();
        const words = screen.getByText(
          "403 AccessDenied: the key cannot write to this bucket",
        );
        expect(words.tagName).toBe("CODE");
        expect(words).toHaveClass("font-mono");
      });

      it("keeps Continue off, and lets the person try again", async () => {
        testAction.mockResolvedValue(
          fail("unreachable", "dial tcp: no such host"),
        );
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());
        await screen.findByText("Could not connect");

        expect(proceed()).toBeDisabled();
        expect(testButton()).toBeEnabled();

        testAction.mockResolvedValue(PASS);
        await user.click(testButton());
        expect(await screen.findByText("Connected")).toBeInTheDocument();
        expect(proceed()).toBeEnabled();
      });

      it("names the provider in the sentences that do", async () => {
        testAction.mockResolvedValue(fail("unreachable"));
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        expect(
          await screen.findByText("S3 could not be reached."),
        ).toBeInTheDocument();
      });

      it("uses the words for the local network when the server refuses it", async () => {
        testAction.mockResolvedValue(fail("endpoint_blocked"));
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        expect(
          await screen.findByText(
            "This server does not allow addresses on the local network.",
          ),
        ).toBeInTheDocument();
        expect(
          screen.getByText(
            "Use a public address, or ask your administrator to allow the local network.",
          ),
        ).toBeInTheDocument();
      });

      it("speaks plainly of a fault that has no code", async () => {
        testAction.mockResolvedValue({
          ok: false,
          error: "Too many attempts. Try again in a minute.",
        });
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        expect(
          await screen.findByText("Too many attempts. Try again in a minute."),
        ).toBeInTheDocument();
        expect(proceed()).toBeDisabled();
      });

      it("copes with an action that throws", async () => {
        testAction.mockRejectedValue(new Error("network"));
        const { user } = renderAt(URL);
        await fillS3(user);

        await user.click(testButton());

        expect(
          await screen.findByText("Something went wrong."),
        ).toBeInTheDocument();
        expect(proceed()).toBeDisabled();
      });
    });
  });

  describe("a WebDAV server", () => {
    const URL = "/settings/backup/setup?step=connect&provider=webdav";

    async function fillWebdav(user: ReturnType<typeof userEvent.setup>) {
      await user.type(
        screen.getByLabelText("Server address"),
        "cloud.example.com/remote.php/dav/files/ada",
      );
      await user.type(screen.getByLabelText("Folder"), "Backups");
      await user.type(screen.getByLabelText("Username"), "ada");
      await user.type(screen.getByLabelText("Password"), "hunter2-hunter2");
    }

    it("asks for the address, folder, username and password", () => {
      renderAt(URL);

      for (const label of [
        "Server address",
        "Folder",
        "Username",
        "Password",
      ]) {
        expect(screen.getByLabelText(label)).toBeInTheDocument();
      }
    });

    it("tests what was typed, and takes the server type from More options", async () => {
      const { user } = renderAt(URL);
      await fillWebdav(user);
      await user.click(screen.getByRole("button", { name: "More options" }));
      await user.selectOptions(
        screen.getByLabelText("Server type"),
        "Nextcloud",
      );

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledExactlyOnceWith({
        provider: "webdav",
        credentials: {
          url: "https://cloud.example.com/remote.php/dav/files/ada",
          vendor: "nextcloud",
          username: "ada",
          password: "hunter2-hunter2",
          folder: "Backups",
        },
      });
    });

    it("calls an unknown server 'other' until told otherwise", async () => {
      const { user } = renderAt(URL);
      await fillWebdav(user);

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledWith({
        provider: "webdav",
        credentials: expect.objectContaining({ vendor: "other" }),
      });
    });

    it("keeps an address that already says http or https as it is", async () => {
      const { user } = renderAt(URL);
      await fillWebdav(user);
      const address = screen.getByLabelText("Server address");
      await user.clear(address);
      await user.type(address, "http://nas.local:5005/dav");

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledWith({
        provider: "webdav",
        credentials: expect.objectContaining({
          url: "http://nas.local:5005/dav",
        }),
      });
    });
  });

  describe("Proton Drive", () => {
    const URL = "/settings/backup/setup?step=connect&provider=proton_drive";

    it("says what it is before it asks for anything", () => {
      renderAt(URL);

      expect(
        screen.getByText(
          "Experimental. Balancia keeps this account's password on this server so it can sign in.",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByText("Only if your account has a separate one."),
      ).toBeInTheDocument();
      expect(
        screen.getByText(/The secret key behind your authenticator app/),
      ).toBeInTheDocument();
    });

    it("leaves out what it was not given", async () => {
      const { user } = renderAt(URL);
      await user.type(screen.getByLabelText("Username"), "ada@proton.me");
      await user.type(screen.getByLabelText("Password"), "hunter2-hunter2");

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledExactlyOnceWith({
        provider: "proton_drive",
        credentials: { username: "ada@proton.me", password: "hunter2-hunter2" },
      });
    });

    it("sends the mailbox password and the authenticator's secret when it has them", async () => {
      const { user } = renderAt(URL);
      await user.type(screen.getByLabelText("Username"), "ada@proton.me");
      await user.type(screen.getByLabelText("Password"), "hunter2-hunter2");
      await user.type(
        screen.getByLabelText("Mailbox password"),
        "mailbox-pass",
      );
      await user.type(
        screen.getByLabelText("Two-factor secret"),
        "JBSWY3DPEHPK3PXP",
      );

      await user.click(testButton());

      expect(testAction).toHaveBeenCalledWith({
        provider: "proton_drive",
        credentials: {
          username: "ada@proton.me",
          password: "hunter2-hunter2",
          mailboxPassword: "mailbox-pass",
          otpSecret: "JBSWY3DPEHPK3PXP",
        },
      });
    });
  });

  describe("Infomaniak", () => {
    const URL = "/settings/backup/setup?step=connect&provider=infomaniak";

    it("asks which of its services first, and shows no form until it is told", () => {
      renderAt(URL);

      expect(screen.getByText("Which Infomaniak service?")).toBeInTheDocument();
      expect(screen.getByRole("radio", { name: "kDrive" })).not.toBeChecked();
      expect(
        screen.getByRole("radio", { name: "Swiss Backup" }),
      ).not.toBeChecked();
      expect(
        screen.queryByRole("button", { name: "Test connection" }),
      ).toBeNull();
      expect(proceed()).toBeDisabled();
    });

    it("takes kDrive as a WebDAV server of no particular kind", async () => {
      const { user } = renderAt(URL);
      await user.click(screen.getByRole("radio", { name: "kDrive" }));

      await user.type(
        screen.getByLabelText("Server address"),
        "https://12345.connect.kdrive.infomaniak.com",
      );
      await user.type(screen.getByLabelText("Username"), "ada@example.com");
      await user.type(screen.getByLabelText("Password"), "app-password");
      // The server's type is not a question to put to somebody who has said kDrive.
      expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
      await user.click(testButton());

      expect(testAction).toHaveBeenCalledExactlyOnceWith({
        provider: "webdav",
        credentials: {
          url: "https://12345.connect.kdrive.infomaniak.com",
          vendor: "other",
          username: "ada@example.com",
          password: "app-password",
          folder: "",
        },
      });
    });

    it("takes Swiss Backup as S3 with its own preset, and no service to pick", async () => {
      const { user } = renderAt(URL);
      await user.click(screen.getByRole("radio", { name: "Swiss Backup" }));

      expect(screen.queryByLabelText("Service")).toBeNull();
      await user.type(
        screen.getByLabelText("Server address"),
        "s3.swiss-backup02.infomaniak.com",
      );
      await fillS3(user);
      await user.click(testButton());

      expect(testAction).toHaveBeenCalledExactlyOnceWith({
        provider: "s3",
        credentials: {
          endpoint: "https://s3.swiss-backup02.infomaniak.com",
          region: "eu-central-1",
          flavour: "Other",
          bucket: "family-backups",
          prefix: "",
          accessKeyId: "AKIAEXAMPLE",
          secretAccessKey: "s3cr3t-value",
          pathStyle: false,
        },
      });
    });

    it("forgets a pass when the other service is chosen", async () => {
      const { user } = renderAt(URL);
      await user.click(screen.getByRole("radio", { name: "kDrive" }));
      await user.type(
        screen.getByLabelText("Server address"),
        "kdrive.example.com",
      );
      await user.type(screen.getByLabelText("Username"), "ada");
      await user.type(screen.getByLabelText("Password"), "pw");
      await user.click(testButton());
      await screen.findByText("Connected");
      expect(proceed()).toBeEnabled();

      await user.click(screen.getByRole("radio", { name: "Swiss Backup" }));

      expect(proceed()).toBeDisabled();
      expect(screen.queryByText("Connected")).toBeNull();
    });
  });

  it("is not a place to arrive without having chosen one", () => {
    renderAt("/settings/backup/setup?step=connect");
    expect(
      screen.getByRole("heading", { name: "Choose where to back up" }),
    ).toBeInTheDocument();
  });

  it("waits for the person to press Test, and does not test by itself", async () => {
    const { user } = renderAt(
      "/settings/backup/setup?step=connect&provider=s3",
    );
    await fillS3(user);

    await waitFor(() => expect(testAction).not.toHaveBeenCalled());
  });
});
