import { gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRecoveryKey, encryptTo } from "@/modules/backup/age";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { RestoreScreen, type RestoreDestination } from "./restore-screen";

/**
 * The day the server is gone, or the key is all that is left.
 *
 * These are real round trips: a backup is made here the way the worker makes
 * one (JSON, gzip, age), put in a `File` or behind a mocked `fetch`, and opened
 * by the code the screen actually runs. Only the network and the browser's
 * download are stand-ins. What the tests hold to is what a person sees, and
 * the one promise the screen makes that nothing on it can show: the recovery
 * key is never sent, stored or printed.
 */

// jsdom's Blob can be read but not streamed, and `openBackup` gunzips through a
// stream. This is the browser's `Blob.prototype.stream`, for this file only.
if (typeof Blob.prototype.stream !== "function") {
  Blob.prototype.stream = function stream(this: Blob) {
    const bytes = this.arrayBuffer();
    return new ReadableStream({
      async start(controller) {
        controller.enqueue(new Uint8Array(await bytes));
        controller.close();
      },
    });
  } as typeof Blob.prototype.stream;
}

const DESTINATION: RestoreDestination = {
  id: "5d3f0f6e-6a38-4b4e-9d57-3a4d4c0b7e11",
  provider: "Google Drive",
};

const NEWEST = "balancia-backup-20261009T033012Z.json.gz.age";
const MIDDLE = "balancia-backup-20261008T033011Z.json.gz.age";
const OLDEST = "balancia-backup-20261006T033010Z.json.gz.age";

/** Deliberately not in order: the screen is the one that puts them so. */
const LISTED = [
  { name: OLDEST, takenAt: "2026-10-06T03:30:10.000Z" },
  { name: NEWEST, takenAt: "2026-10-09T03:30:12.000Z" },
  { name: MIDDLE, takenAt: "2026-10-08T03:30:11.000Z" },
];

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const group = (name: string, expenses = 2) => ({
  balancia: { exportVersion: 1, exportedAt: "2026-10-09T03:30:00.000Z" },
  group: { id: `id-${name}`, name, currencyMode: "separate" },
  participants: [{ id: "p1" }, { id: "p2" }],
  expenses: Array.from({ length: expenses }, (_, index) => ({
    id: `e${index}`,
  })),
  settlements: [{ id: "s1" }],
});

/** A backup exactly as the worker writes one, and the key that opens it. */
async function backup(groups: unknown[], version = 1) {
  const { identity, recipient } = await createRecoveryKey();
  const bundle = {
    balancia: {
      backupVersion: version,
      createdAt: "2026-10-09T03:30:00.000Z",
      instance: "balancia.example.com",
    },
    groups,
  };
  const bytes = await encryptTo(
    recipient,
    gzipSync(Buffer.from(JSON.stringify(bundle), "utf8")),
  );
  return { identity, bytes };
}

/** Anything age can open, whatever is inside it. */
async function sealed(plaintext: Uint8Array) {
  const { identity, recipient } = await createRecoveryKey();
  return { identity, bytes: await encryptTo(recipient, plaintext) };
}

const asFile = (bytes: Uint8Array, name = NEWEST) =>
  new File([bytes as BlobPart], name);

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });

/** The cloud answers a listing, and hands over `bytes` for any file asked for. */
function cloudHolds(files = LISTED, bytes?: Uint8Array) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/files")) return json({ files });
    if (bytes && url.includes("/files/")) {
      return new Response(new Uint8Array(bytes), {
        headers: { "Content-Length": String(bytes.length) },
      });
    }
    return json({}, { status: 404 });
  });
}

const written = (iso: string) =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(iso));

function renderScreen(
  props: {
    available?: boolean;
    destination?: RestoreDestination | null;
    locale?: "en" | "fr";
  } = {},
) {
  // Before the render: the clipboard stub is attached to the window here.
  const user = userEvent.setup();
  renderWithIntl(
    <RestoreScreen
      available={props.available ?? true}
      destination={props.destination ?? null}
    />,
    // The words the browser really has on this route.
    { area: "backup", locale: props.locale },
  );
  return user;
}

const keyField = () => screen.getByLabelText("Your recovery key");
const enterKey = (value: string) =>
  fireEvent.change(keyField(), { target: { value } });
const openButton = () => screen.getByRole("button", { name: "Open backup" });
const chooseFile = (user: ReturnType<typeof userEvent.setup>, file: File) =>
  user.upload(screen.getByLabelText("Choose the .age file"), file);
const foundHeading = (name: RegExp | string) =>
  screen.findByRole("heading", { name });

/** Replaces what the browser would download with something a test can read. */
function captureDownloads() {
  const blobs: Blob[] = [];
  const clicked: { download: string; href: string }[] = [];
  const revoke = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation(() => undefined);
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:balancia-${blobs.length}`;
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function click(this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    },
  );
  return { blobs, clicked, revoke };
}

describe("opening a backup from a file", () => {
  it("takes the groups out, with their people and entries", async () => {
    const { identity, bytes } = await backup([
      group("Lisbon trip", 3),
      group("Flat", 1),
    ]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());

    const heading = await foundHeading("2 groups in this backup");
    expect(heading).toHaveFocus();
    expect(
      screen.getByText(
        `Made ${written("2026-10-09T03:30:00.000Z")} on balancia.example.com. Nothing has been imported yet.`,
      ),
    ).toBeInTheDocument();

    const lisbon = screen.getByText("Lisbon trip").closest("li") as HTMLElement;
    // Three expenses and a repayment; two people.
    expect(within(lisbon).getByText("2 people")).toBeInTheDocument();
    expect(within(lisbon).getByText("4 entries")).toBeInTheDocument();
    const flat = screen.getByText("Flat").closest("li") as HTMLElement;
    expect(within(flat).getByText("2 entries")).toBeInTheDocument();

    // The way back in is the group's own Import. Nothing here makes a group.
    expect(
      screen.getByText(/create a group, then use Import in its settings/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Import into a new group/ }),
    ).not.toBeInTheDocument();
  });

  it("downloads a group as the JSON it was exported as", async () => {
    const { identity, bytes } = await backup([
      group("Lisbon trip", 3),
      group("Flat"),
    ]);
    const downloads = captureDownloads();
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());
    await foundHeading("2 groups in this backup");
    await user.click(
      within(
        screen.getByText("Lisbon trip").closest("li") as HTMLElement,
      ).getByRole("button", { name: "Download as JSON" }),
    );

    expect(downloads.clicked).toEqual([
      { download: "balancia-lisbon-trip.json", href: "blob:balancia-1" },
    ]);
    expect(JSON.parse(await downloads.blobs[0].text())).toEqual(
      group("Lisbon trip", 3),
    );
    // The object URL is let go once the browser has started the download.
    await waitFor(
      () => expect(downloads.revoke).toHaveBeenCalledWith("blob:balancia-1"),
      { timeout: 2500 },
    );
  });

  it("names each Download button after its group for a screen reader", async () => {
    const { identity, bytes } = await backup([
      group("Lisbon trip"),
      group("Flat"),
    ]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());
    await foundHeading("2 groups in this backup");

    const buttons = screen.getAllByRole("button", { name: "Download as JSON" });
    expect(
      buttons.map((button) => button.getAttribute("aria-describedby")),
    ).not.toContain(null);
    expect(buttons[0]).toHaveAccessibleDescription("Lisbon trip");
    expect(buttons[1]).toHaveAccessibleDescription("Flat");
  });

  it("opens with Enter from the key field", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(keyField());
    await user.keyboard("{Enter}");

    await foundHeading("1 group in this backup");
  });

  it("waits for a backup and a key before it will open anything", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    const user = renderScreen();

    expect(openButton()).toBeDisabled();

    await chooseFile(user, asFile(bytes));
    expect(openButton()).toBeDisabled();

    enterKey("   ");
    expect(openButton()).toBeDisabled();

    enterKey(identity);
    expect(openButton()).toBeEnabled();
  });

  it("shows the chosen file, lets it be swapped, and drops what it showed", async () => {
    const first = await backup([group("Flat")]);
    const second = await backup([group("Lisbon trip")]);
    const user = renderScreen();

    await chooseFile(user, asFile(first.bytes, "first.json.gz.age"));
    expect(screen.getByText("first.json.gz.age")).toBeInTheDocument();
    enterKey(first.identity);
    await user.click(openButton());
    await foundHeading("1 group in this backup");

    // Another file is another question: the groups of the first no longer apply.
    await user.click(screen.getByRole("button", { name: "Choose another" }));
    await chooseFile(user, asFile(second.bytes, "second.json.gz.age"));

    expect(screen.getByText("second.json.gz.age")).toBeInTheDocument();
    expect(screen.queryByText("first.json.gz.age")).not.toBeInTheDocument();
    expect(screen.queryByText("Flat")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /in this backup/ }),
    ).not.toBeInTheDocument();
  });

  it("takes a file dropped on it", async () => {
    const { bytes } = await backup([group("Flat")]);
    renderScreen();
    const zone = screen.getByText("or drop it here");

    // Without preventDefault the browser would open the file in the tab.
    expect(
      fireEvent.dragOver(zone, { dataTransfer: { types: ["Files"] } }),
    ).toBe(false);
    fireEvent.drop(zone, {
      dataTransfer: { files: [asFile(bytes, "dropped.json.gz.age")] },
    });

    expect(await screen.findByText("dropped.json.gz.age")).toBeInTheDocument();
  });

  it("refuses a file too large to be a backup, without keeping it", async () => {
    const user = renderScreen();
    const huge = new File(["x"], "huge.age");
    Object.defineProperty(huge, "size", { value: 301 * 1024 * 1024 });

    await chooseFile(user, huge);

    expect(
      within(screen.getByRole("alert")).getByText(
        "That file is too large to be a backup.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("huge.age")).not.toBeInTheDocument();
    enterKey("AGE-SECRET-KEY-1ANYTHING");
    expect(openButton()).toBeDisabled();
  });
});

describe("when it cannot be opened", () => {
  it("says under the key field that the key does not fit, and nothing else", async () => {
    const { bytes } = await backup([group("Flat")]);
    const other = await createRecoveryKey();
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(other.identity);
    await user.click(openButton());

    const message = await screen.findByText(
      "That key does not open this backup.",
    );
    expect(keyField()).toHaveAttribute("aria-invalid", "true");
    expect(keyField()).toHaveAccessibleDescription(
      expect.stringContaining("That key does not open this backup."),
    );
    expect(message).toBeInTheDocument();
    // The file is fine; the only thing to change is the key.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /in this backup/ }),
    ).not.toBeInTheDocument();

    // Typing another key takes the message away.
    enterKey("AGE-SECRET-KEY-1");
    expect(
      screen.queryByText("That key does not open this backup."),
    ).not.toBeInTheDocument();
    expect(keyField()).toHaveAttribute("aria-invalid", "false");
  });

  it("calls a mistyped or truncated key the key's fault, not the file's", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    const user = renderScreen();
    await chooseFile(user, asFile(bytes));

    // Same length, wrong checksum: age's own message for this reads like a
    // damaged file's, and it is `openBackup` that tells the key's fault apart.
    const slipped =
      identity.slice(0, -3) + (identity.endsWith("QQQ") ? "PPP" : "QQQ");
    for (const wrong of [slipped, identity.slice(0, 24), "not a key at all"]) {
      enterKey(wrong);
      await user.click(openButton());
      await screen.findByText("That key does not open this backup.");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    }
  });

  it("says a file that is not age at all could not be read", async () => {
    const { identity } = await createRecoveryKey();
    const user = renderScreen();

    await chooseFile(
      user,
      asFile(new TextEncoder().encode("hello, this is not encrypted")),
    );
    enterKey(identity);
    await user.click(openButton());

    expect(
      await within(await screen.findByRole("alert")).findByText(
        /That file could not be read\. It may not be a Balancia backup/,
      ),
    ).toBeInTheDocument();
    // A different file is the cure; the key is not in question.
    expect(keyField()).toHaveAttribute("aria-invalid", "false");
  });

  it("says a file that opens but is not a Balancia backup is not one", async () => {
    const { identity, bytes } = await sealed(
      new TextEncoder().encode("just some text"),
    );
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());

    expect(
      await within(await screen.findByRole("alert")).findByText(
        "That file opens, but it is not a Balancia backup.",
      ),
    ).toBeInTheDocument();
  });

  it("asks for a newer Balancia when the backup comes from one", async () => {
    const { identity, bytes } = await backup([group("Flat")], 2);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());

    expect(
      await within(await screen.findByRole("alert")).findByText(
        "This backup was made by a newer Balancia. Update this server to open it.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: /in this backup/ }),
    ).not.toBeInTheDocument();
  });

  it("clears the alert when another file is chosen", async () => {
    const { identity, bytes } = await backup([group("Flat")], 2);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());
    await screen.findByRole("alert");
    await chooseFile(user, asFile(bytes, "again.json.gz.age"));

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("what a backup can hold", () => {
  it("lists a backup with no groups as found, with nothing to download", async () => {
    const { identity, bytes } = await backup([]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());

    await foundHeading("0 groups in this backup");
    expect(
      screen.queryByRole("button", { name: "Download as JSON" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    // The way out that needs no Balancia is still there.
    expect(screen.getByText("Or decrypt it yourself")).toBeInTheDocument();
  });

  it("shows five groups, then the rest on request", async () => {
    const names = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"];
    const { identity, bytes } = await backup(names.map((name) => group(name)));
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());
    await foundHeading("7 groups in this backup");

    expect(
      screen.getAllByRole("button", { name: "Download as JSON" }),
    ).toHaveLength(5);
    expect(screen.queryByText("Six")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Show 2 more groups" }),
    );

    expect(
      screen.getAllByRole("button", { name: "Download as JSON" }),
    ).toHaveLength(7);
    expect(screen.getByText("Seven")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /more groups/ }),
    ).not.toBeInTheDocument();
  });
});

describe("the recovery key file", () => {
  it("puts the key from an age-keygen file into the field, masked", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const user = renderScreen();
    const keyFile = new File(
      [
        `# created: 2026-10-09T03:30:12Z\n# public key: ${recipient}\n${identity}\n`,
      ],
      "recovery-key.txt",
      { type: "text/plain" },
    );

    await user.upload(screen.getByLabelText("Choose a key file"), keyFile);

    await waitFor(() => expect(keyField()).toHaveValue(identity));
    expect(keyField()).toHaveAttribute("type", "password");
  });

  it("opens a backup with the key it loaded", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    await user.upload(
      screen.getByLabelText("Choose a key file"),
      new File([`# created: today\n${identity}\n`], "recovery-key.txt"),
    );
    await waitFor(() => expect(openButton()).toBeEnabled());
    await user.click(openButton());

    await foundHeading("1 group in this backup");
  });

  it("says so, under the field, when the file has no key in it", async () => {
    const user = renderScreen();

    await user.upload(
      screen.getByLabelText("Choose a key file"),
      new File(["shopping list\nmilk\n"], "notes.txt"),
    );

    expect(
      await screen.findByText("No recovery key was found in that file."),
    ).toBeInTheDocument();
    expect(keyField()).toHaveAttribute("aria-invalid", "true");
    expect(keyField()).toHaveAccessibleDescription(
      expect.stringContaining("No recovery key was found in that file."),
    );
    // Nothing was tried, so nothing was found not to fit.
    expect(
      screen.queryByText("That key does not open this backup."),
    ).not.toBeInTheDocument();
    expect(keyField()).toHaveValue("");
  });

  it("does not read a file too big to be a key file", async () => {
    const { identity } = await createRecoveryKey();
    const user = renderScreen();
    const big = new File([identity], "disk-image.txt");
    Object.defineProperty(big, "size", { value: 5 * 1024 * 1024 });

    await user.upload(screen.getByLabelText("Choose a key file"), big);

    expect(
      await screen.findByText("No recovery key was found in that file."),
    ).toBeInTheDocument();
    expect(keyField()).toHaveValue("");
  });

  it("takes the no-key message away when a key is typed or a good file loaded", async () => {
    const { identity } = await createRecoveryKey();
    const user = renderScreen();

    await user.upload(
      screen.getByLabelText("Choose a key file"),
      new File(["milk"], "notes.txt"),
    );
    await screen.findByText("No recovery key was found in that file.");
    enterKey("AGE-SECRET-KEY-1");
    expect(
      screen.queryByText("No recovery key was found in that file."),
    ).not.toBeInTheDocument();

    await user.upload(
      screen.getByLabelText("Choose a key file"),
      new File(["milk"], "notes.txt"),
    );
    await screen.findByText("No recovery key was found in that file.");
    await user.upload(
      screen.getByLabelText("Choose a key file"),
      new File([`${identity}\n`], "recovery-key.txt"),
    );

    await waitFor(() => expect(keyField()).toHaveValue(identity));
    expect(
      screen.queryByText("No recovery key was found in that file."),
    ).not.toBeInTheDocument();
    expect(keyField()).toHaveAttribute("aria-invalid", "false");
  });

  it("finds the key in a whole key file pasted into the field", async () => {
    const { identity, recipient } = await createRecoveryKey();
    const { bytes } = await backup([group("Flat")]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    // The text box swallows the newlines and leaves the comments on the key.
    enterKey(`# created: 2026-10-09 # public key: ${recipient} ${identity}`);

    // A different backup, so this key cannot open it: what matters is that the
    // key was found and tried rather than refused as malformed.
    await user.click(openButton());
    await screen.findByText("That key does not open this backup.");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("from the cloud", () => {
  it("lists the backups newest first, the newest already chosen", async () => {
    cloudHolds();
    renderScreen({ destination: DESTINATION });

    const rows = await screen.findAllByRole("radio");

    expect(
      rows.map((row) => within(row).getByText(/\.age$/).textContent),
    ).toEqual([NEWEST, MIDDLE, OLDEST]);
    expect(
      within(rows[0]).getByText(written("2026-10-09T03:30:12.000Z")),
    ).toBeInTheDocument();
    expect(rows.map((row) => row.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);
    expect(
      screen.getByRole("button", { name: "From my cloud", pressed: true }),
    ).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/backup/destinations/${DESTINATION.id}/files`,
      expect.anything(),
    );
  });

  it("downloads the backup when Open is pressed, and not before", async () => {
    const { identity, bytes } = await backup([group("Lisbon trip")]);
    cloudHolds(LISTED, bytes);
    const user = renderScreen({ destination: DESTINATION });

    await screen.findAllByRole("radio");
    enterKey(identity);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(openButton());

    await foundHeading("1 group in this backup");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/backup/destinations/${DESTINATION.id}/files/${NEWEST}`,
      expect.anything(),
    );
  });

  it("downloads the one that was chosen", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    cloudHolds(LISTED, bytes);
    const user = renderScreen({ destination: DESTINATION });

    const rows = await screen.findAllByRole("radio");
    await user.click(rows[1]);
    expect(screen.getAllByRole("radio")[1]).toBeChecked();
    enterKey(identity);
    await user.click(openButton());

    await foundHeading("1 group in this backup");
    expect(fetchMock).toHaveBeenLastCalledWith(
      `/api/backup/destinations/${DESTINATION.id}/files/${MIDDLE}`,
      expect.anything(),
    );
  });

  it("moves through the backups with the arrow keys", async () => {
    cloudHolds();
    const user = renderScreen({ destination: DESTINATION });

    const [newest] = await screen.findAllByRole("radio");
    newest.focus();
    await user.keyboard("{ArrowDown}");

    expect(screen.getAllByRole("radio")[1]).toBeChecked();
  });

  it("shows that it is working while it downloads and opens", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    let release: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/files")
        ? json({ files: LISTED })
        : new Promise<Response>((resolve) => {
            release = resolve;
          }),
    );
    const user = renderScreen({ destination: DESTINATION });

    await screen.findAllByRole("radio");
    enterKey(identity);
    await user.click(openButton());

    const busy = await screen.findByRole("button", { name: "Opening…" });
    expect(busy).toBeDisabled();
    expect(keyField()).toBeDisabled();
    expect(screen.getByRole("button", { name: "From a file" })).toBeDisabled();
    expect(screen.getByRole("status", { name: "" })).toHaveTextContent(
      "Opening…",
    );

    await waitFor(() => expect(release).toBeDefined());
    release?.(new Response(new Uint8Array(bytes)));
    await foundHeading("1 group in this backup");
    expect(keyField()).toBeEnabled();
  });

  it("does not list the cloud again for a trip to the file and back", async () => {
    cloudHolds();
    const user = renderScreen({ destination: DESTINATION });
    await screen.findAllByRole("radio");

    await user.click(screen.getByRole("button", { name: "From a file" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText("or drop it here")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "From my cloud" }));

    expect(screen.getAllByRole("radio")).toHaveLength(3);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("says it is loading while the list is on its way", () => {
    fetchMock.mockReturnValue(new Promise(() => undefined));
    renderScreen({ destination: DESTINATION });

    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(openButton()).toBeDisabled();
  });

  it("says there is nothing in the cloud yet, and offers the file", async () => {
    cloudHolds([]);
    renderScreen({ destination: DESTINATION });

    expect(
      await screen.findByText("No backups found in Google Drive yet."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "From a file" })).toBeEnabled();
  });

  it("says why the list failed in the provider's terms, and tries again", async () => {
    fetchMock.mockResolvedValueOnce(
      json({ code: "reconnect" }, { status: 502 }),
    );
    const user = renderScreen({ destination: DESTINATION });

    const alert = await screen.findByRole("alert");
    expect(
      within(alert).getByText(
        "The list could not be read from Google Drive. Try again, or use the file.",
      ),
    ).toBeInTheDocument();
    expect(
      within(alert).getByText("Access was revoked or has expired."),
    ).toBeInTheDocument();
    // "Balancia will try again" is about the schedule, not about this.
    expect(alert).not.toHaveTextContent("Reconnect to carry on");

    cloudHolds();
    await user.click(within(alert).getByRole("button", { name: "Try again" }));

    expect(await screen.findAllByRole("radio")).toHaveLength(3);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("names the provider in the sentence about its failure", async () => {
    fetchMock.mockResolvedValue(json({ code: "unreachable" }, { status: 502 }));
    renderScreen({ destination: DESTINATION });

    expect(
      await within(await screen.findByRole("alert")).findByText(
        "Google Drive could not be reached.",
      ),
    ).toBeInTheDocument();
  });

  it("says only that the list failed when the network did", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    renderScreen({ destination: DESTINATION });

    const alert = await screen.findByRole("alert");

    expect(alert).toHaveTextContent(
      "The list could not be read from Google Drive. Try again, or use the file.",
    );
    expect(alert).not.toHaveTextContent("Something went wrong");
  });

  it("says it was the download that failed, not the list, above the source", async () => {
    const { identity } = await backup([group("Flat")]);
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/files")
        ? json({ files: LISTED })
        : json({ code: "unreachable" }, { status: 502 }),
    );
    const user = renderScreen({ destination: DESTINATION });

    await screen.findAllByRole("radio");
    enterKey(identity);
    await user.click(openButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That backup could not be downloaded from Google Drive. Try again, or use the file.",
    );
    expect(alert).toHaveTextContent("Google Drive could not be reached.");
    expect(alert).not.toHaveTextContent("The list could not be read");
    // The choice is kept, so trying again is one press.
    expect(screen.getAllByRole("radio")[0]).toBeChecked();
    expect(keyField()).toHaveAttribute("aria-invalid", "false");
    expect(openButton()).toBeEnabled();
  });

  it("says only that the download failed when the network did", async () => {
    const { identity } = await backup([group("Flat")]);
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith("/files")) return json({ files: LISTED });
      throw new TypeError("Failed to fetch");
    });
    const user = renderScreen({ destination: DESTINATION });

    await screen.findAllByRole("radio");
    enterKey(identity);
    await user.click(openButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "That backup could not be downloaded from Google Drive. Try again, or use the file.",
    );
    expect(alert).not.toHaveTextContent("Something went wrong");
  });

  it("refuses a download announced as too large without reading it", async () => {
    const { identity } = await backup([group("Flat")]);
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith("/files")
        ? json({ files: LISTED })
        : new Response(new Uint8Array(4), {
            headers: { "Content-Length": String(301 * 1024 * 1024) },
          }),
    );
    const user = renderScreen({ destination: DESTINATION });

    await screen.findAllByRole("radio");
    enterKey(identity);
    await user.click(openButton());

    expect(
      await within(await screen.findByRole("alert")).findByText(
        "That file is too large to be a backup.",
      ),
    ).toBeInTheDocument();
  });

  it("offers no cloud when there is nothing to list", () => {
    const { unmount } = renderWithIntl(
      <RestoreScreen available={false} destination={DESTINATION} />,
      { area: "backup" },
    );

    expect(
      screen.queryByRole("button", { name: "From my cloud" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("or drop it here")).toBeInTheDocument();
    unmount();

    renderWithIntl(<RestoreScreen available destination={null} />, {
      area: "backup",
    });
    expect(
      screen.queryByRole("button", { name: "From my cloud" }),
    ).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the recovery key stays in the page", () => {
  it("is in no request, no storage, no address and no console line", async () => {
    const logged = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => vi.spyOn(console, method).mockImplementation(() => undefined),
    );
    const { identity, bytes } = await backup([group("Flat")]);
    const other = await createRecoveryKey();
    cloudHolds(LISTED, bytes);
    const user = renderScreen({ destination: DESTINATION });
    const address = window.location.href;

    // Wrong key, then the right one, then a key file: every way one gets in.
    await screen.findAllByRole("radio");
    enterKey(other.identity);
    await user.click(openButton());
    await screen.findByText("That key does not open this backup.");
    enterKey("not even a key");
    await user.click(openButton());
    await user.upload(
      screen.getByLabelText("Choose a key file"),
      new File([`${identity}\n`], "recovery-key.txt"),
    );
    await waitFor(() => expect(keyField()).toHaveValue(identity));
    await user.click(openButton());
    await foundHeading("1 group in this backup");

    const requests = JSON.stringify(fetchMock.mock.calls);
    for (const secret of [identity, other.identity, "not even a key"]) {
      expect(requests).not.toContain(secret);
      // Nor a piece of it long enough to be one.
      expect(requests).not.toContain(secret.slice(-12));
    }
    expect(
      fetchMock.mock.calls.every(([url]) =>
        String(url).startsWith(
          `/api/backup/destinations/${DESTINATION.id}/files`,
        ),
      ),
    ).toBe(true);

    expect(window.localStorage).toHaveLength(0);
    expect(window.sessionStorage).toHaveLength(0);
    expect(window.location.href).toBe(address);
    expect(document.cookie).not.toContain(identity.slice(-12));
    const printed = JSON.stringify(logged.flatMap((spy) => spy.mock.calls));
    expect(printed).not.toContain(identity.slice(-12));
    expect(printed).not.toContain(other.identity.slice(-12));

    // It is held in the field and nowhere in the markup that can be read back
    // out: the field is masked, and the key is not in the page's text.
    expect(keyField()).toHaveAttribute("type", "password");
    expect(document.body.textContent).not.toContain(identity.slice(-12));
  });

  it("says so beside the field, and describes the field by it", () => {
    renderScreen();

    expect(
      screen.getByText(
        "The backup is opened in this browser. Your key stays here and is not sent anywhere.",
      ),
    ).toBeInTheDocument();
    expect(keyField()).toHaveAccessibleDescription(
      "The backup is opened in this browser. Your key stays here and is not sent anywhere.",
    );
    expect(keyField()).toHaveAttribute("autocomplete", "off");
    expect(keyField()).toHaveAttribute("spellcheck", "false");
    expect(keyField()).toHaveAttribute("placeholder", "AGE-SECRET-KEY-1…");
  });
});

describe("in French", () => {
  it("finds every word it needs, plurals included", async () => {
    const names = ["Un", "Deux", "Trois", "Quatre", "Cinq", "Six", "Sept"];
    const { identity, bytes } = await backup(names.map((name) => group(name)));
    const user = renderScreen({ locale: "fr" });

    expect(screen.getByText("Sauvegarde")).toBeInTheDocument();
    await user.upload(
      screen.getByLabelText("Choisir le fichier .age"),
      asFile(bytes),
    );
    fireEvent.change(screen.getByLabelText("Ta clé de récupération"), {
      target: { value: identity },
    });
    await user.click(
      screen.getByRole("button", { name: "Ouvrir la sauvegarde" }),
    );

    await foundHeading("7 groupes dans cette sauvegarde");
    expect(
      screen.getByText(/^Créée le .* sur balancia\.example\.com\. Rien/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Afficher 2 groupes de plus" }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("2 personnes")).toHaveLength(5);
    expect(screen.getByText("Ou déchiffre-la toi-même")).toBeInTheDocument();
  });
});

describe("decrypting it yourself", () => {
  it("is on the screen before anything has been opened", () => {
    renderScreen();

    expect(screen.getByText("Or decrypt it yourself")).toBeInTheDocument();
    expect(
      screen.getByText(
        "age -d -i recovery-key.txt balancia-backup-20261009T033012Z.json.gz.age | gunzip > backup.json",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Receipts are separate files in the same folder/),
    ).toBeInTheDocument();
  });

  it("copies the command, and says it has", async () => {
    const user = renderScreen();

    await user.click(screen.getByRole("button", { name: "Copy" }));

    expect(await navigator.clipboard.readText()).toBe(
      "age -d -i recovery-key.txt balancia-backup-20261009T033012Z.json.gz.age | gunzip > backup.json",
    );
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
  });

  it("stays below the groups once a backup is open", async () => {
    const { identity, bytes } = await backup([group("Flat")]);
    const user = renderScreen();

    await chooseFile(user, asFile(bytes));
    enterKey(identity);
    await user.click(openButton());
    const found = await foundHeading("1 group in this backup");
    const yourself = screen.getByText("Or decrypt it yourself");

    expect(
      found.compareDocumentPosition(yourself) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
