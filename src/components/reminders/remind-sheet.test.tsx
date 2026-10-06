import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RemindSheet } from "./remind-sheet";
import { sendReminderAction } from "@/modules/reminders/actions";
import { reminderInputSchema } from "@/modules/reminders/schemas";
import type {
  RemindPayOption,
  RemindRecipient,
} from "@/modules/reminders/types";

// The sheet is being tested, not the server: the action is the boundary.
vi.mock("@/modules/reminders/actions", () => ({
  sendReminderAction: vi.fn(async () => ({
    ok: true,
    data: { channel: "push", shareText: null, recipientName: "Jonas" },
  })),
}));

/**
 * Step one is about consent and expectation: who is being asked, how the
 * message will actually reach them, and who is off-limits because they were
 * asked yesterday.
 */

function recipient(overrides: Partial<RemindRecipient> = {}): RemindRecipient {
  return {
    participantId: "jonas",
    name: "Jonas",
    debts: [{ amount: "14800", currency: "EUR" }],
    channel: "push",
    payWith: [],
    lastRemindedAt: null,
    locked: false,
    muted: false,
    link: { kind: "group" },
    ...overrides,
  };
}

/**
 * Rendered inside its sheet, because that is the only place it exists: each
 * step's heading is the dialog's own title, so the two cannot be separated.
 */
function render(recipients: RemindRecipient[]) {
  return renderWithIntl(
    <Sheet open>
      <SheetContent side="bottom">
        <RemindSheet
          groupId="g1"
          groupName="Portugal, March"
          senderName="Seb"
          recipients={recipients}
          onDone={() => {}}
        />
      </SheetContent>
    </Sheet>,
  );
}

/** The share sheet, which jsdom does not have. */
function stubShare() {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => {});
  Object.defineProperty(navigator, "share", {
    value: share,
    configurable: true,
    writable: true,
  });
  return share;
}

/** The text handed to the share sheet, which is the message as it goes out. */
function sharedText(share: ReturnType<typeof stubShare>): string {
  return share.mock.calls.at(-1)?.[0].text ?? "";
}

/** What the action was actually asked to record, narrowed by the schema. */
function sentMessage(): string {
  const [, input] = vi.mocked(sendReminderAction).mock.calls.at(-1)!;
  return reminderInputSchema.shape.message.parse(
    (input as { message: unknown }).message,
  );
}

describe("choosing who to remind", () => {
  it("says how each person's message will reach them", () => {
    render([
      recipient(),
      recipient({
        participantId: "padi",
        name: "Padi",
        channel: "share",
        debts: [{ amount: "10000", currency: "EUR" }],
      }),
    ]);

    expect(screen.getByText("Notification")).toBeInTheDocument();
    expect(screen.getByText("Share sheet")).toBeInTheDocument();
  });

  /**
   * Somebody who silenced the group still gets asked — the debt is real — but
   * never through a channel they switched off, and the row says which it is
   * before anything is sent.
   */
  it("does not quietly push to somebody who muted the group", () => {
    render([
      recipient({ channel: "share", muted: true }),
      recipient({ participantId: "padi", name: "Padi", channel: "share" }),
    ]);

    expect(screen.getByText("Muted")).toBeInTheDocument();
    expect(screen.queryByText("Notification")).not.toBeInTheDocument();
  });

  it("preselects everyone who can be reminded", () => {
    render([recipient(), recipient({ participantId: "padi", name: "Padi" })]);

    for (const box of screen.getAllByRole("checkbox")) {
      expect(box).toBeChecked();
    }
  });

  it("shows someone reminded yesterday, but will not let them be picked", () => {
    render([
      recipient({
        locked: true,
        lastRemindedAt: "2026-08-14T09:00:00.000Z",
      }),
    ]);

    const box = screen.getByRole("checkbox");
    expect(box).toBeDisabled();
    expect(box).not.toBeChecked();
    expect(screen.getByText(/Reminded/)).toBeInTheDocument();
  });

  /**
   * A group that spent in two currencies owes two simplified debts between the
   * same pair. That is one person to ask, once — so one row, not two, and a
   * count of people rather than of debts. Somebody else is in the list only
   * because a list of one does not show this screen at all.
   */
  it("asks somebody who owes in two currencies once, for both", () => {
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
      recipient({
        participantId: "padi",
        name: "Padi",
        debts: [{ amount: "10000", currency: "EUR" }],
      }),
    ]);

    // Two people, three debts.
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
    expect(screen.getByText("€148.00")).toBeInTheDocument();
    expect(screen.getByText("¥1,400")).toBeInTheDocument();
    expect(
      screen.getByText("2 people owe you €248.00 and ¥1,400."),
    ).toBeInTheDocument();
  });

  it("totals what is owed per currency, and never across them", () => {
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
      recipient({
        participantId: "padi",
        name: "Padi",
        debts: [
          { amount: "10000", currency: "EUR" },
          { amount: "600", currency: "JPY" },
        ],
      }),
    ]);

    expect(
      screen.getByText("2 people owe you €248.00 and ¥2,000."),
    ).toBeInTheDocument();
  });

  it("cannot go on to a message with nobody selected", async () => {
    const user = userEvent.setup();
    render([recipient(), recipient({ participantId: "padi", name: "Padi" })]);

    for (const box of screen.getAllByRole("checkbox")) {
      await user.click(box);
    }
    expect(
      screen.getByRole("button", { name: /write the message/i }),
    ).toBeDisabled();
  });

  /**
   * The figure follows the selection, not the list: unticking somebody has to
   * change the total, or the sheet would keep quoting money nobody is about to
   * be asked for.
   */
  it("counts what the selection is owed, not what the group is", async () => {
    const user = userEvent.setup();
    render([
      recipient(),
      recipient({
        participantId: "padi",
        name: "Padi",
        debts: [{ amount: "10000", currency: "EUR" }],
      }),
    ]);

    expect(screen.getByText("2 people owe you €248.00.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("checkbox")[1]);
    expect(screen.getByText("1 person owes you €148.00.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("checkbox")[0]);
    expect(screen.getByText("Choose who to remind.")).toBeInTheDocument();
  });
});

/**
 * A list of one is not a choice, and the screen that exists to make one has
 * nothing to offer. It gets out of the way — but only when that single row
 * could have been ticked, and only when it really is the only row.
 */
describe("a sheet with one person in it", () => {
  it("opens on the message, not on a list of one", () => {
    render([recipient()]);

    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.getByRole("textbox", { name: /the message to send/i }),
    ).toBeInTheDocument();
  });

  it("offers no way back to the screen it skipped", () => {
    render([recipient()]);

    expect(
      screen.queryByRole("button", { name: /back to who/i }),
    ).not.toBeInTheDocument();
  });

  /** Nobody to write to, so the row stays and says when it was last asked. */
  it("keeps the list when the only person was reminded yesterday", () => {
    render([
      recipient({ locked: true, lastRemindedAt: "2026-08-14T09:00:00.000Z" }),
    ]);

    expect(
      screen.getByRole("button", { name: /write the message/i }),
    ).toBeInTheDocument();
  });

  /** Two rows are still a list, even when only one of them can be ticked. */
  it("keeps the list when somebody else was reminded yesterday", () => {
    render([
      recipient(),
      recipient({
        participantId: "padi",
        name: "Padi",
        locked: true,
        lastRemindedAt: "2026-08-14T09:00:00.000Z",
      }),
    ]);

    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });
});

describe("writing the message", () => {
  it("fills the draft in with the debt and who it is owed to", () => {
    render([recipient()]);

    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /the message to send/i,
    });
    // The opening draft is drawn at random from the gentle ones, and only five
    // of the seven name the group — so the assertion holds to the two facts
    // every draft in the library carries.
    expect(draft.value).toContain("€148.00");
    expect(draft.value).toContain("Seb");
  });

  /**
   * Naming one of two currencies would ask for part of the debt while spending
   * the whole day's allowance, so the draft names both.
   */
  it("names every currency the person owes in", () => {
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
    ]);

    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /the message to send/i,
    });
    expect(draft.value).toContain("€148.00 and ¥1,400");
  });

  /** One person, one send — not one per currency. */
  it("does not queue the same person twice", () => {
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
    ]);

    // Singular: one person to ask, however many currencies they owe in.
    expect(
      screen.getByText("Jonas owes you · Portugal, March"),
    ).toBeInTheDocument();
  });

  it("names the channel on the button that will do the sending", () => {
    render([recipient()]);

    expect(
      screen.getByRole("button", { name: "Send to Jonas in Balancia" }),
    ).toBeInTheDocument();
  });

  it("offers to share instead when Balancia cannot deliver", () => {
    render([recipient({ channel: "share" })]);

    expect(
      screen.getByRole("button", { name: "Share with Jonas" }),
    ).toBeInTheDocument();
  });

  /**
   * The link goes out with a reminder that has to travel, but it is not part
   * of the text being edited: keeping it beside the box rather than inside it
   * is what stops a sender typing past the end and pushing the URL out of
   * sight.
   */
  it("shows the group link beside the draft, not inside it", () => {
    render([recipient({ channel: "share" })]);

    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /the message to send/i,
    });
    expect(draft.value).not.toContain("/groups/g1");
    expect(screen.getByText(/\/groups\/g1$/)).toBeInTheDocument();
  });

  /**
   * A reminder the app delivers itself lands on a card that opens the group,
   * in front of somebody already inside it. An address for the page they are
   * looking at is nothing to attach — so neither the message nor the chip
   * under the draft carries one.
   */
  it("attaches no link to a reminder that never leaves the app", async () => {
    const user = userEvent.setup();
    render([recipient()]);

    expect(screen.queryByText(/\/groups\/g1$/)).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Send to Jonas in Balancia" }),
    );

    await waitFor(() => expect(sendReminderAction).toHaveBeenCalled());
    const [, input] = vi.mocked(sendReminderAction).mock.calls.at(-1)!;
    /*
     * Parsed rather than cast: the action's parameter is `unknown`, and the
     * schema's own field is what narrows it. Only the message, because the
     * recipients in this file are named "jonas" and "padi" rather than the
     * UUIDs the real column holds.
     */
    const message = reminderInputSchema.shape.message.parse(
      (input as { message: unknown }).message,
    );
    expect(message).not.toContain("/groups/g1");
    expect(message).toContain("€148.00");
  });

  it("goes back without losing who was chosen", async () => {
    const user = userEvent.setup();
    render([recipient(), recipient({ participantId: "padi", name: "Padi" })]);

    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );
    await user.click(screen.getByRole("button", { name: /back to who/i }));

    const boxes = screen.getAllByRole("checkbox");
    expect(boxes[0]).not.toBeChecked();
    expect(boxes[1]).toBeChecked();
  });
});

/**
 * "€148.00" and "€148.00, and here is the account it goes to" are different
 * messages, and only the second one gets paid that evening. What is asserted
 * here is that the second one is what actually leaves — in the same message as
 * the figure, not as a second thing to go and find.
 */
describe("the way to pay", () => {
  const BANK: RemindPayOption = {
    method: "bank",
    kind: "detail",
    text: "DE89370400440532013000",
    code: null,
  };
  const PAYPAL: RemindPayOption = {
    method: "paypal",
    kind: "link",
    text: "https://paypal.me/seb/148.00EUR",
    code: null,
  };

  it("shows it beside the draft rather than inside the text being edited", () => {
    render([recipient({ channel: "share", payWith: [BANK] })]);

    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /the message to send/i,
    });
    expect(draft.value).not.toContain("DE89370400440532013000");
    expect(
      screen.getByText("Bank transfer: DE89370400440532013000"),
    ).toBeInTheDocument();
  });

  it("sends it in the same message as the amount", async () => {
    const user = userEvent.setup();
    const share = stubShare();
    render([recipient({ channel: "share", payWith: [BANK] })]);

    await user.click(screen.getByRole("button", { name: "Share with Jonas" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const text = sharedText(share);
    expect(text).toContain("€148.00");
    expect(text).toContain("Bank transfer: DE89370400440532013000");
    expect(text).toContain("/groups/g1");

    // And the same words are what gets recorded, not a tidied-up copy.
    await waitFor(() => expect(sendReminderAction).toHaveBeenCalled());
    expect(sentMessage()).toBe(text);
  });

  /**
   * A reminder pasted into a group chat is read by everybody in it, not only
   * by the person who owes — so leaving the account number out is one press.
   */
  it("comes out again in one press", async () => {
    const user = userEvent.setup();
    const share = stubShare();
    render([recipient({ channel: "share", payWith: [BANK] })]);

    await user.click(screen.getByRole("button", { name: "How to pay" }));

    expect(
      screen.queryByText("Bank transfer: DE89370400440532013000"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share with Jonas" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const text = sharedText(share);
    expect(text).not.toContain("DE89370400440532013000");
    // The group link is a separate decision and stays where it was.
    expect(text).toContain("/groups/g1");
  });

  /**
   * The order is the reader's own ranking, so the first is what goes without
   * anybody choosing — but a preference is not a capability, and the person
   * being asked may only be able to use the second.
   */
  it("sends the first way listed, and lets the sender pick another", async () => {
    const user = userEvent.setup();
    render([recipient({ channel: "share", payWith: [BANK, PAYPAL] })]);

    expect(
      screen.getByText("Bank transfer: DE89370400440532013000"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "PayPal" }));

    expect(
      screen.getByText("PayPal: https://paypal.me/seb/148.00EUR"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Bank transfer: DE89370400440532013000"),
    ).not.toBeInTheDocument();
  });

  /** One way of being paid is not a choice, so there is nothing to press. */
  it("offers no switch when there is only one way to be paid", () => {
    render([recipient({ channel: "share", payWith: [BANK] })]);

    expect(
      screen.queryByRole("group", { name: /which way to pay/i }),
    ).not.toBeInTheDocument();
  });

  /**
   * A reminder Balancia delivers itself lands on a card with a Settle up
   * button, and behind that button is the payout panel with the same code
   * drawn large. Sending it as text too would be the second copy.
   */
  it("attaches nothing to a reminder that never leaves the app", async () => {
    const user = userEvent.setup();
    render([recipient({ payWith: [BANK] })]);

    expect(
      screen.queryByRole("button", { name: "How to pay" }),
    ).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Send to Jonas in Balancia" }),
    );

    await waitFor(() => expect(sendReminderAction).toHaveBeenCalled());
    expect(sentMessage()).not.toContain("DE89370400440532013000");
  });

  /** Nothing to offer, and no dead control saying so. */
  it("says nothing at all when the reader has never said how to pay them", () => {
    render([recipient({ channel: "share" })]);

    expect(
      screen.queryByRole("button", { name: "How to pay" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/\/groups\/g1$/)).toBeInTheDocument();
  });
});

/**
 * A new wording asked for over words the sender typed. This asked through
 * `window.confirm` — "OK" and "Cancel", in the browser's language — and now
 * asks in the app's own dialog, whose buttons say which one keeps the text.
 */
describe("replacing what the sender wrote", () => {
  const MINE = "Hey Jonas, about the flat";
  const draftBox = () =>
    screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /the message to send/i,
    });

  async function typeOwnWords() {
    const user = userEvent.setup();
    render([recipient()]);
    await user.clear(draftBox());
    await user.type(draftBox(), MINE);
    return user;
  }

  it("asks in the app's own words, never the browser's", async () => {
    const confirm = vi.spyOn(window, "confirm");
    const user = await typeOwnWords();

    await user.click(screen.getByRole("button", { name: "Another wording" }));

    const dialog = await screen.findByRole("alertdialog", {
      name: "Replace the message you wrote?",
    });
    expect(
      within(dialog).getByRole("button", { name: "Replace my message" }),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Keep my message" }),
    ).toBeVisible();
    expect(confirm).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it("keeps the sender's words when they say so", async () => {
    const user = await typeOwnWords();

    await user.click(screen.getByRole("button", { name: "Another wording" }));
    await user.click(
      await screen.findByRole("button", { name: "Keep my message" }),
    );

    await waitFor(() =>
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument(),
    );
    expect(draftBox().value).toBe(MINE);
  });

  it("puts a new wording in when they agree", async () => {
    const user = await typeOwnWords();

    await user.click(screen.getByRole("button", { name: "Another wording" }));
    await user.click(
      await screen.findByRole("button", { name: "Replace my message" }),
    );

    await waitFor(() => expect(draftBox().value).not.toBe(MINE));
    expect(draftBox().value).toContain("€148.00");
  });

  it("asks the same before a change of tone throws the words away", async () => {
    const user = await typeOwnWords();

    await user.click(screen.getByRole("button", { name: "Dry" }));

    expect(
      await screen.findByRole("alertdialog", {
        name: "Replace the message you wrote?",
      }),
    ).toBeVisible();
    // Nothing has moved while the question is open. The sheet behind the
    // dialog is hidden from assistive technology meanwhile, hence `hidden`.
    expect(
      screen.getByRole("button", { name: "Gentle", hidden: true }),
    ).toHaveAttribute("aria-pressed", "true");

    await user.click(
      screen.getByRole("button", { name: "Replace my message" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Dry" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    expect(draftBox().value).not.toBe(MINE);
  });

  it("does not ask when there is nothing of the sender's to lose", async () => {
    const user = userEvent.setup();
    render([recipient()]);
    const before = draftBox().value;

    await user.click(screen.getByRole("button", { name: "Another wording" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(draftBox().value).not.toBe(before);
  });
});

/**
 * Whether the group's Activity says a reminder went out. It was a pill that
 * read like a tag on the message; it is a switch, named for where the line
 * will appear, and it is a choice about this send rather than a setting.
 */
describe("the line in the group's activity", () => {
  it("is a switch, on unless the sender turns it off", () => {
    render([recipient()]);

    const toggle = screen.getByRole("switch", {
      name: "Show in group activity",
    });
    expect(toggle).toBeChecked();
    // The pill it replaced is gone.
    expect(
      screen.queryByRole("button", { name: /visible to the group/i }),
    ).not.toBeInTheDocument();
  });

  it("goes with the reminder it was set for, and saves nothing on its own", async () => {
    vi.mocked(sendReminderAction).mockClear();
    const user = userEvent.setup();
    render([recipient()]);

    await user.click(
      screen.getByRole("switch", { name: "Show in group activity" }),
    );

    expect(
      screen.getByRole("switch", { name: "Show in group activity" }),
    ).not.toBeChecked();
    // Moving it writes nothing; only sending does.
    expect(sendReminderAction).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Send to Jonas in Balancia" }),
    );

    await waitFor(() => expect(sendReminderAction).toHaveBeenCalled());
    const [, input] = vi.mocked(sendReminderAction).mock.calls.at(-1)!;
    expect(input).toMatchObject({ logToActivity: false });
  });

  it("can be turned from its label too", async () => {
    const user = userEvent.setup();
    render([recipient()]);

    await user.click(screen.getByText("Show in group activity"));

    expect(
      screen.getByRole("switch", { name: "Show in group activity" }),
    ).not.toBeChecked();
  });
});

/**
 * Somebody added by name, with no account, who opened the group's page from a
 * reminder met a sign-in form asking for a password they never had. Where the
 * server says the sender may hand out the group's invite link, and it still
 * works, that is what their message ends with instead — the screen that asks
 * which name on the list is theirs.
 */
describe("the link at the end", () => {
  const INVITE =
    "https://balancia.example/join/g/AbCdEfGhIjKlMnOpQrStUvWxYz012345678";

  it("ends with the invite link for somebody who has no account", async () => {
    const user = userEvent.setup();
    const share = stubShare();
    render([
      recipient({ channel: "share", link: { kind: "invite", url: INVITE } }),
    ]);

    await user.click(screen.getByRole("button", { name: "Share with Jonas" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    const text = sharedText(share);
    expect(text.split("\n").at(-1)).toBe(INVITE);
    expect(text).not.toContain("/groups/g1");

    await waitFor(() => expect(sendReminderAction).toHaveBeenCalled());
    expect(sentMessage()).toBe(text);
  });

  /**
   * Named for what it does in the hands of whoever opens it, and by the name
   * the People screen gives it.
   */
  it("calls it the group link under the draft", () => {
    render([
      recipient({ channel: "share", link: { kind: "invite", url: INVITE } }),
    ]);

    expect(screen.getByText("Group link")).toBeInTheDocument();
    expect(screen.queryByText("Group page")).not.toBeInTheDocument();
    expect(
      screen.getByText(INVITE.replace("https://", "")),
    ).toBeInTheDocument();
  });

  it("keeps the group's address, and its name, for everybody else", async () => {
    const user = userEvent.setup();
    const share = stubShare();
    render([recipient({ channel: "share" })]);

    expect(screen.getByText("Group page")).toBeInTheDocument();
    expect(screen.queryByText("Group link")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Share with Jonas" }));

    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(sharedText(share).split("\n").at(-1)).toMatch(/\/groups\/g1$/);
  });

  /**
   * Two people in one queue can need two different links: the sheet follows
   * the recipient, not the first row it was opened on.
   */
  it("changes link with the person, down the queue", async () => {
    vi.mocked(sendReminderAction).mockClear();
    const user = userEvent.setup();
    const share = stubShare();
    render([
      recipient({ channel: "share" }),
      recipient({
        participantId: "padi",
        name: "Padi",
        channel: "share",
        link: { kind: "invite", url: INVITE },
      }),
    ]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );
    await user.click(screen.getByRole("button", { name: "Share with Jonas" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(sharedText(share)).toMatch(/\/groups\/g1$/);

    await user.click(
      await screen.findByRole("button", { name: "Share with Padi" }),
    );
    await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
    expect(sharedText(share).split("\n").at(-1)).toBe(INVITE);
  });
});
