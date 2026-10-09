import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { TelemetryTestButton } from "./telemetry-test-button";

/**
 * The administrator's "send test report".
 *
 * What is pinned is what the toast says when it fails. The action answers with
 * one word from a fixed list, and the button used to drop it, so a collector
 * that answered 404 — nothing was collecting at the address — read the same as
 * a network that was down, and the administrator had nothing to go on.
 */

const { sendTestReportAction, toastError, toastSuccess } = vi.hoisted(() => ({
  sendTestReportAction: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/modules/telemetry/actions", () => ({
  sendTestReportAction: () => sendTestReportAction(),
}));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: toastSuccess },
}));

beforeEach(() => {
  sendTestReportAction.mockReset();
  toastError.mockReset();
  toastSuccess.mockReset();
});

async function press(options: { locale?: "en" | "fr" } = {}) {
  const user = userEvent.setup();
  renderWithIntl(<TelemetryTestButton canSend usageEnabled />, options);
  await user.click(
    screen.getByRole("button", {
      name:
        options.locale === "fr"
          ? "Envoyer un rapport de test"
          : "Send test report",
    }),
  );
}

describe("TelemetryTestButton", () => {
  it("says so when the report went out, and nothing else", async () => {
    sendTestReportAction.mockResolvedValue({
      ok: true,
      data: { status: "sent" },
    });
    await press();

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Report sent."),
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it.each([
    [
      "rejected",
      "The destination answered with an error and did not accept the report.",
    ],
    ["network", "This server could not reach the destination."],
    ["timeout", "The destination did not answer in time."],
    [
      "unsafe-payload",
      "The report was held back before sending because it did not pass this server’s own checks.",
    ],
  ])("says why when the send failed as %s", async (reason, description) => {
    sendTestReportAction.mockResolvedValue({
      ok: true,
      data: { status: "failed", reason },
    });
    await press();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("The report could not be sent.", {
        description,
      }),
    );
  });

  it("says it in French in French", async () => {
    sendTestReportAction.mockResolvedValue({
      ok: true,
      data: { status: "failed", reason: "rejected" },
    });
    await press({ locale: "fr" });

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Le rapport n’a pas pu être envoyé.",
        {
          description:
            "La destination a répondu par une erreur et n’a pas accepté le rapport.",
        },
      ),
    );
  });

  it("adds nothing for a reason it has no sentence for", async () => {
    sendTestReportAction.mockResolvedValue({
      ok: true,
      data: { status: "failed", reason: "no-endpoint" },
    });
    await press();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The report could not be sent.",
        undefined,
      ),
    );
  });

  it("does not take a reason that is merely a property of every object", async () => {
    sendTestReportAction.mockResolvedValue({
      ok: true,
      data: { status: "failed", reason: "constructor" },
    });
    await press();

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The report could not be sent.",
        undefined,
      ),
    );
  });

  it("speaks the refusal when the action itself was refused", async () => {
    sendTestReportAction.mockResolvedValue({ ok: false, error: "Slow down." });
    await press();

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("Slow down."));
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
