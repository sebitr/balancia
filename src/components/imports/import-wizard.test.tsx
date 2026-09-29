import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { MAX_IMPORT_BYTES } from "@/modules/imports/limits";
import { ImportWizard } from "./import-wizard";

/**
 * The upload step, on a file too large for the trip to the server.
 *
 * The file travels in a Server Action whose body the framework caps, and past
 * that cap the request dies with a framework error before the import ever
 * sees it. So the wizard measures the file as it is chosen and says what the
 * limit is; and whatever else goes wrong on the way, the reader is told rather
 * than left looking at a button that stopped spinning.
 */

const stageImportAction = vi.fn();

vi.mock("@/modules/imports/actions", () => ({
  stageImportAction: (...args: unknown[]) => stageImportAction(...args),
  commitImportAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  stageImportAction.mockReset();
});

const TOO_LARGE =
  "That file is larger than 1 MB, the most one import can read.";

function exportOf(bytes: number): File {
  return new File(["x".repeat(bytes)], "splitwise.csv", { type: "text/csv" });
}

async function choose(file: File) {
  const user = userEvent.setup();
  renderWithIntl(<ImportWizard groupId="group-1" />);
  const input = screen.getByLabelText<HTMLInputElement>("Backup or export");
  await user.upload(input, file);
  return { user, input };
}

describe("ImportWizard upload", () => {
  it("says how large a file it takes", () => {
    renderWithIntl(<ImportWizard groupId="group-1" />);
    expect(screen.getByText(/up to 1 MB/)).toBeInTheDocument();
  });

  it("refuses a file between 1 and 10 MiB as it is chosen, and says why", async () => {
    const { user, input } = await choose(exportOf(2 * 1024 * 1024));

    expect(screen.getByText(TOO_LARGE)).toBeInTheDocument();
    // Cleared, so the required field keeps the form from sending it anyway.
    expect(input.value).toBe("");
    await user.click(screen.getByRole("button", { name: "Read the file" }));
    expect(stageImportAction).not.toHaveBeenCalled();
  });

  it("takes a file right at the limit", async () => {
    await choose(exportOf(MAX_IMPORT_BYTES));
    expect(screen.queryByText(TOO_LARGE)).not.toBeInTheDocument();
  });

  it("says the file could not be read when the request itself fails", async () => {
    stageImportAction.mockRejectedValue(new Error("Body exceeded 1 MB limit"));
    const { input } = await choose(exportOf(10));

    // Submitted directly: jsdom does not count a file set by the test as
    // filling a required input, so a click would stop at validation.
    fireEvent.submit(input.form!);

    expect(
      await screen.findByText("That file could not be read."),
    ).toBeInTheDocument();
    expect(stageImportAction).toHaveBeenCalledTimes(1);
  });
});
