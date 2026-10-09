import { StrictMode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../../tests/helpers/intl";
import { KeyStep } from "./key-step";

/**
 * Step 1, as a person meets it.
 *
 * The step exists to make Continue hard to press by accident: until the box is
 * ticked and the last six characters have been typed back, nothing is saved.
 * The tests walk that gate, and then the two things that can go wrong after it
 * — the server refusing the key, and a key the person brought themselves.
 */

const { createKey, saveKey } = vi.hoisted(() => ({
  createKey: vi.fn(),
  saveKey: vi.fn(),
}));

const BODY = "QPZRY9X8GF2TVDW0S3JN54KHCE6MUA7LQPZRY9X8GF2TVDW0S3JN54KHCE";
const IDENTITY = `AGE-SECRET-KEY-1${BODY}`;
const RECIPIENT = "age1fixedrecipientforthetests";

vi.mock("@/modules/backup/age", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/modules/backup/age")>()),
  createRecoveryKey: createKey,
}));
vi.mock("@/modules/backup/actions", () => ({
  saveRecoveryKeyAction: saveKey,
}));

function renderStep(rotate = false) {
  const onSaved = vi.fn();
  const onCancel = vi.fn();
  const view = renderWithIntl(
    <KeyStep rotate={rotate} onSaved={onSaved} onCancel={onCancel} />,
  );
  return { ...view, onSaved, onCancel, user: userEvent.setup() };
}

const proceed = () => screen.getByRole("button", { name: "Continue" });
const confirmField = () => screen.getByLabelText("Type the last 6 characters");
const tick = () =>
  screen.getByRole("checkbox", {
    name: "I have saved my recovery key somewhere safe",
  });

describe("KeyStep", () => {
  beforeEach(() => {
    createKey.mockReset().mockResolvedValue({
      identity: IDENTITY,
      recipient: RECIPIENT,
    });
    saveKey
      .mockReset()
      .mockResolvedValue({ ok: true, data: { ok: true, value: {} } });
  });

  it("makes the key once, even where React runs an effect twice", async () => {
    renderWithIntl(
      <StrictMode>
        <KeyStep rotate={false} onSaved={vi.fn()} onCancel={vi.fn()} />
      </StrictMode>,
    );

    expect(await screen.findByText("AGE-SECRET-KEY-1")).toBeInTheDocument();
    expect(createKey).toHaveBeenCalledOnce();
  });

  it("starts with Continue off, and says what is missing", async () => {
    renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");

    expect(proceed()).toBeDisabled();
    expect(
      screen.getByText(
        "Tick the box and type the last 6 characters to continue.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "If you leave now, this key is thrown away and a new one is made next time.",
      ),
    ).toBeInTheDocument();
  });

  it("keeps the loss warning here, in the hand with the key", async () => {
    renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");

    expect(screen.getByText("If you lose it")).toBeInTheDocument();
    expect(screen.getByText(/There is no reset/)).toBeInTheDocument();
  });

  it("needs both the box and the characters", async () => {
    const { user } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");

    await user.click(tick());
    expect(proceed()).toBeDisabled();

    await user.type(confirmField(), "54KHCE");
    expect(screen.getByText("Matches")).toBeInTheDocument();
    expect(proceed()).toBeEnabled();

    // Taking the tick back takes Continue back.
    await user.click(tick());
    expect(proceed()).toBeDisabled();
  });

  it("says so beside the field when six characters are wrong", async () => {
    const { user } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");
    await user.click(tick());

    await user.type(confirmField(), "54KHCX");

    expect(confirmField()).toHaveAttribute("aria-invalid", "true");
    expect(
      screen.getByText("That doesn't match the end of your key."),
    ).toBeInTheDocument();
    expect(proceed()).toBeDisabled();
  });

  it("is not alarmed by a field that is only part way", async () => {
    const { user } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");

    await user.type(confirmField(), "54K");

    expect(confirmField()).not.toHaveAttribute("aria-invalid");
    expect(
      screen.getByText("They are outlined in the key above."),
    ).toBeInTheDocument();
  });

  it("does not mind case or spaces, so a pasted or written-out key still matches", async () => {
    const { user } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");
    await user.click(tick());

    await user.click(confirmField());
    await user.paste(" 54 kh\nce ");

    expect(proceed()).toBeEnabled();
  });

  it("holds the field to 16px on a phone and to the key's own look", async () => {
    renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");

    const field = confirmField();
    // `Input` brings `text-base md:text-sm`; nothing here may state less.
    expect(field.className).toContain("text-base");
    expect(field.className).not.toMatch(/(^|\s)text-(2xs|xs|sm)(\s|$)/);
    expect(field).toHaveClass("font-mono", "uppercase", "tracking-widest");
    expect(field).toHaveAttribute("inputmode", "text");
    expect(field).toHaveAttribute("autocapitalize", "characters");
  });

  it("sends the public half when Continue is pressed, and only that", async () => {
    const { user, onSaved } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");
    await user.click(tick());
    await user.type(confirmField(), "54khce");

    await user.click(proceed());

    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
    expect(saveKey).toHaveBeenCalledExactlyOnceWith(RECIPIENT);
    expect(JSON.stringify(saveKey.mock.calls)).not.toContain("SECRET");
  });

  it("stays put and says so when the key could not be saved", async () => {
    saveKey.mockResolvedValue({
      ok: true,
      data: { ok: false, code: "invalidKey", detail: "" },
    });
    const { user, onSaved } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");
    await user.click(tick());
    await user.type(confirmField(), "54KHCE");

    await user.click(proceed());

    expect(
      await screen.findByText("The key could not be saved. Try again."),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
    // Still there, still ready: nothing the person did was undone.
    expect(proceed()).toBeEnabled();
  });

  it("says the same for a fault on the server", async () => {
    saveKey.mockResolvedValue({ ok: false, error: "Something went wrong" });
    const { user, onSaved } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");
    await user.click(tick());
    await user.type(confirmField(), "54KHCE");

    await user.click(proceed());

    expect(
      await screen.findByText("The key could not be saved. Try again."),
    ).toBeInTheDocument();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("offers a way out beside Continue", async () => {
    const { user, onCancel } = renderStep();
    await screen.findByText("AGE-SECRET-KEY-1");

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("says plainly when this browser cannot make a key", async () => {
    createKey.mockRejectedValue(new Error("no WebCrypto"));
    renderStep();

    expect(
      await screen.findByText("Something went wrong."),
    ).toBeInTheDocument();
    expect(proceed()).toBeDisabled();
    // The way round it is already on the screen.
    expect(
      screen.getByRole("button", { name: "Use a key I already have" }),
    ).toBeInTheDocument();
  });

  describe("a key the person already has", () => {
    async function openOwn() {
      const view = renderStep();
      await screen.findByText("AGE-SECRET-KEY-1");
      await view.user.click(
        screen.getByRole("button", { name: "Use a key I already have" }),
      );
      return view;
    }

    it("swaps the made key for a field for a public one", async () => {
      await openOwn();

      expect(screen.getByText("Use your own key")).toBeInTheDocument();
      expect(screen.getByLabelText("Public key")).toBeInTheDocument();
      expect(screen.queryByText("AGE-SECRET-KEY-1")).toBeNull();
      expect(screen.queryByText("If you lose it")).toBeNull();
      expect(
        screen.getByRole("button", { name: "Use this key" }),
      ).toBeDisabled();
    });

    it("saves a public key without the tick or the six characters", async () => {
      const real = await vi.importActual<typeof import("@/modules/backup/age")>(
        "@/modules/backup/age",
      );
      const { recipient } = await real.createRecoveryKey();
      const { user, onSaved } = await openOwn();

      await user.type(screen.getByLabelText("Public key"), recipient);
      await user.click(screen.getByRole("button", { name: "Use this key" }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
      expect(saveKey).toHaveBeenCalledExactlyOnceWith(recipient);
    });

    it("refuses what is not a public key without sending it anywhere", async () => {
      const { user, onSaved } = await openOwn();

      // The private half, pasted by mistake.
      await user.type(screen.getByLabelText("Public key"), IDENTITY);
      await user.click(screen.getByRole("button", { name: "Use this key" }));

      expect(
        await screen.findByText(
          "That is not a public key. It starts with age1.",
        ),
      ).toBeInTheDocument();
      expect(screen.getByLabelText("Public key")).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      expect(saveKey).not.toHaveBeenCalled();
      expect(onSaved).not.toHaveBeenCalled();
    });

    it("goes back to the key made here, still the same one", async () => {
      const { user } = await openOwn();

      await user.click(
        screen.getByRole("button", { name: "Make a key here instead" }),
      );

      expect(screen.getByText("AGE-SECRET-KEY-1")).toBeInTheDocument();
      expect(createKey).toHaveBeenCalledOnce();
    });
  });

  describe("a new key for an existing setup", () => {
    it("speaks of a new key, not of setting anything up", async () => {
      renderStep(true);
      await screen.findByText("AGE-SECRET-KEY-1");

      expect(screen.getByText("Your new recovery key")).toBeInTheDocument();
      expect(
        screen.getByText(
          "Backups from now on are locked with this key. Older backups still need your old one.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByText("Create your recovery key")).toBeNull();
    });
  });
});
