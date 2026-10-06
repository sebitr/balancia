import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { settleIntentPath } from "@/components/entries/settle-intent";
import type { RemindRecipient } from "@/modules/reminders/types";
import { SettleActions } from "./settle-actions";
import type { PayoutHintView, SettleUpTransferView } from "./settle-up-screen";

/**
 * What the reader can do about one payment they are in, wherever it is drawn:
 * under a row of the settle screen, or under "You owe Marta" on Marta's page.
 *
 * Balancia never moves money, so nothing here may read like an instruction
 * that would. Every action records something already done, or asks.
 */

const OWED_TO_MARTA: SettleUpTransferView = {
  fromParticipantId: "seb",
  fromName: "Seb",
  toParticipantId: "marta",
  toName: "Marta",
  currency: "CHF",
  minorUnits: "96084",
  fromIsSelf: true,
  toIsSelf: false,
};

const OWED_BY_MARTA: SettleUpTransferView = {
  fromParticipantId: "marta",
  fromName: "Marta",
  toParticipantId: "seb",
  toName: "Seb",
  currency: "CHF",
  minorUnits: "41250",
  fromIsSelf: false,
  toIsSelf: true,
};

function recipient(overrides: Partial<RemindRecipient> = {}): RemindRecipient {
  return {
    participantId: "marta",
    name: "Marta",
    debts: [{ amount: "41250", currency: "CHF" }],
    channel: "share",
    payWith: [],
    lastRemindedAt: null,
    locked: false,
    muted: false,
    link: { kind: "group" },
    ...overrides,
  };
}

function render(
  transfer: SettleUpTransferView,
  options: {
    recipients?: readonly RemindRecipient[];
    payoutHints?: readonly PayoutHintView[];
  } = {},
) {
  return renderWithIntl(
    <SettleActions
      transfer={transfer}
      groupId="g1"
      groupName="Verbier"
      senderName="Seb"
      recipients={options.recipients ?? []}
      payoutHints={options.payoutHints ?? []}
    />,
  );
}

describe("SettleActions", () => {
  it("records a repayment the reader made, in the first person and the past", () => {
    render(OWED_TO_MARTA);

    const link = screen.getByRole("link", {
      name: "Record Seb's repayment to Marta",
    });
    expect(link).toHaveTextContent("I paid Marta");
    expect(link).toHaveAttribute(
      "href",
      settleIntentPath("g1", {
        fromParticipantId: "seb",
        toParticipantId: "marta",
        currency: "CHF",
      }),
    );
    // Nobody is chased for a debt the reader owes.
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
  });

  it("never offers an instruction that would move money", () => {
    render(OWED_TO_MARTA);
    expect(screen.queryByText("Pay Marta back")).toBeNull();
  });

  it("shows how Marta likes to be paid first, with the button at its foot", () => {
    render(OWED_TO_MARTA, {
      payoutHints: [
        {
          participantId: "marta",
          currency: "CHF",
          methods: [{ method: "twint", detail: "+41 79 123 45 67" }],
          qr: null,
          qrMissing: null,
        },
      ],
    });

    expect(screen.getByText("+41 79 123 45 67")).toBeInTheDocument();
    // The method the reader is looking at travels to the drawer with them.
    expect(
      screen.getByRole("link", { name: "Record Seb's repayment to Marta" }),
    ).toHaveAttribute(
      "href",
      settleIntentPath("g1", {
        fromParticipantId: "seb",
        toParticipantId: "marta",
        currency: "CHF",
        method: "twint",
      }),
    );
  });

  it("records a repayment received, and offers to remind", () => {
    render(OWED_BY_MARTA, { recipients: [recipient()] });

    const link = screen.getByRole("link", {
      name: "Record Marta's repayment to Seb",
    });
    expect(link).toHaveTextContent("I was paid back");
    expect(link).toHaveAttribute(
      "href",
      settleIntentPath("g1", {
        fromParticipantId: "marta",
        toParticipantId: "seb",
        currency: "CHF",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Remind Marta" }),
    ).toHaveTextContent("Remind");
  });

  it("offers no reminder the reminder flow does not have on its list", () => {
    render(OWED_BY_MARTA, {
      recipients: [recipient({ participantId: "jonas", name: "Jonas" })],
    });

    expect(screen.getByText("I was paid back")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remind/ })).toBeNull();
  });

  it("says a reminder was sent rather than offering another within the day", () => {
    render(OWED_BY_MARTA, {
      recipients: [
        recipient({ lastRemindedAt: new Date().toISOString(), locked: true }),
      ],
    });

    expect(screen.getByRole("button", { name: /Reminded/ })).toBeDisabled();
  });

  it("offers nothing on a payment between two other people", () => {
    const { container } = render({
      ...OWED_TO_MARTA,
      fromParticipantId: "jonas",
      fromName: "Jonas",
      fromIsSelf: false,
    });
    expect(container).toBeEmptyDOMElement();
  });
});
