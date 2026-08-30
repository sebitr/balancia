import { describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RemindSheet } from "./remind-sheet";
import { sendReminderAction } from "@/modules/reminders/actions";
import type { RemindRecipient } from "@/modules/reminders/types";

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
    lastRemindedAt: null,
    locked: false,
    muted: false,
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
    expect(input.message).not.toContain("/groups/g1");
    expect(input.message).toContain("€148.00");
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
