import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { RemindSheet } from "./remind-sheet";
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

    expect(
      screen.getByText("Notifications on · arrives in Balancia"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("No app yet · goes through your share sheet"),
    ).toBeInTheDocument();
  });

  /**
   * Somebody who silenced the group still gets asked — the debt is real — but
   * never through a channel they switched off, and the row says which it is
   * before anything is sent.
   */
  it("does not quietly push to somebody who muted the group", () => {
    render([recipient({ channel: "share", muted: true })]);

    expect(
      screen.getByText("Reminders muted · goes through your share sheet"),
    ).toBeInTheDocument();
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
   * same pair. That is one person to ask, once — so one row, one checkbox, and
   * a count of people rather than of debts.
   */
  it("asks somebody who owes in two currencies once, for both", () => {
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
    ]);

    expect(screen.getAllByRole("checkbox")).toHaveLength(1);
    expect(screen.getByText("€148.00")).toBeInTheDocument();
    expect(screen.getByText("¥1,400")).toBeInTheDocument();
    expect(
      screen.getByText("1 person owes you €148.00 and ¥1,400."),
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
    render([recipient()]);

    await user.click(screen.getByRole("checkbox"));
    expect(
      screen.getByRole("button", { name: /write the message/i }),
    ).toBeDisabled();
  });
});

describe("writing the message", () => {
  it("fills the draft in with the debt and who it is owed to", async () => {
    const user = userEvent.setup();
    render([recipient()]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );

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
  it("names every currency the person owes in", async () => {
    const user = userEvent.setup();
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
    ]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );

    const draft = screen.getByRole<HTMLTextAreaElement>("textbox", {
      name: /the message to send/i,
    });
    expect(draft.value).toContain("€148.00 and ¥1,400");
  });

  /** One person, one send — not one per currency. */
  it("does not queue the same person twice", async () => {
    const user = userEvent.setup();
    render([
      recipient({
        debts: [
          { amount: "14800", currency: "EUR" },
          { amount: "1400", currency: "JPY" },
        ],
      }),
    ]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );

    expect(screen.getByText("Jonas · sent one by one")).toBeInTheDocument();
  });

  it("names the channel on the button that will do the sending", async () => {
    const user = userEvent.setup();
    render([recipient()]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );

    expect(
      screen.getByRole("button", { name: "Send to Jonas in Balancia" }),
    ).toBeInTheDocument();
  });

  it("offers to share instead when Balancia cannot deliver", async () => {
    const user = userEvent.setup();
    render([recipient({ channel: "share" })]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );

    expect(
      screen.getByRole("button", { name: "Share with Jonas" }),
    ).toBeInTheDocument();
  });

  it("counts the draft against the whole library", async () => {
    const user = userEvent.setup();
    render([recipient()]);

    await user.click(
      screen.getByRole("button", { name: /write the message/i }),
    );

    expect(screen.getByText(/Draft \d+ of 20/)).toBeInTheDocument();
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
