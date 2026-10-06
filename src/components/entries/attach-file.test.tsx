import { describe, expect, it, vi } from "vitest";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { AttachFile } from "./attach-file";

const { upload } = vi.hoisted(() => ({ upload: vi.fn() }));
vi.mock("@/components/expenses/upload-receipt", () => ({
  uploadReceipt: upload,
}));

function renderAttach(
  overrides: Partial<Parameters<typeof AttachFile>[0]> = {},
) {
  return renderWithIntl(
    <AttachFile
      groupId="g1"
      files={[]}
      onAttached={vi.fn()}
      onRemove={vi.fn()}
      {...overrides}
    />,
  );
}

/**
 * The attach control is a row like the date and Repeats.
 *
 * It was a 22px line of text under the last card, the one control on the
 * sheet with nothing around it to hit.
 */
describe("the attach row", () => {
  it("is a full row in a card, named for what it does", () => {
    renderAttach();

    const row = screen.getByRole("button", { name: "Attach a file" });
    expect(row).toHaveClass("min-h-[52px]", "w-full");
    expect(row.closest(".shadow-hairline")).not.toBeNull();
  });

  it("opens the file picker", async () => {
    const user = userEvent.setup();
    renderAttach();

    const input =
      document.querySelector<HTMLInputElement>('input[type="file"]');
    const click = vi.spyOn(input as HTMLInputElement, "click");
    await user.click(screen.getByRole("button", { name: "Attach a file" }));

    expect(click).toHaveBeenCalled();
  });

  it("lists each file as a row of its own, with a remove button to hit", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderAttach({ files: [{ id: "f1", name: "bill.pdf" }], onRemove });

    const remove = screen.getByRole("button", { name: "Remove bill.pdf" });
    expect(remove).toHaveClass("tap-target");
    await user.click(remove);

    expect(onRemove).toHaveBeenCalledWith("f1");
  });

  it("is off and says why when nothing can be attached", () => {
    renderAttach({
      files: [{ id: "f1", name: "bill.pdf" }],
      unavailable: "Files are not kept on a repeating entry.",
    });

    const row = screen.getByRole("button", { name: "Attach a file" });
    expect(row).toBeDisabled();
    expect(row).toHaveAccessibleDescription(
      "Files are not kept on a repeating entry.",
    );
    // What is already attached is still there, to come back with Repeats off.
    expect(screen.getByText("bill.pdf")).toBeInTheDocument();
  });
});
