import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithIntl } from "../../../tests/helpers/intl";
import { VoiceButton } from "./voice-button";
import { forgetCloudConsent, writeCloudConsent } from "./voice-consent";

/**
 * The button that opens the microphone, and every way it has to close it
 * again.
 *
 * `continuous = false` asks the engine for a single utterance and leaves the
 * engine to decide when that utterance ended. When its endpointer does not
 * decide — a noisy room, a headset holding the stream open, an engine that
 * simply never fires `end` — nothing else used to close the session, and the
 * button sat on "Listening…" with the microphone live. Every test below is
 * one of the ways out, because the bug was not that any single one was wrong:
 * it was that there was only ever one, and it belonged to the engine.
 *
 * The recogniser is faked rather than driven, since jsdom has no microphone
 * and the real one answers a web service. What is asserted is the contract
 * this component holds it to.
 */

const { toastError } = vi.hoisted(() => ({ toastError: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

interface Fake {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  processLocally?: boolean;
  started: number;
  stopped: number;
  aborted: number;
  onresult: ((event: unknown) => void) | null;
  onspeechend: (() => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** The last recogniser the component built, with its wiring exposed. */
let last: Fake | null = null;
/** Read through a call so assigning `null` mid-test does not narrow the type. */
const built = (): Fake | null => last;
/** Set by the one test that asks what happens when `start()` throws. */
let failStart = false;

/**
 * A recogniser that does nothing until a test tells it to.
 *
 * A factory rather than a class: `new` on a function returning an object
 * yields that object, which keeps the counters on a plain closure instead of
 * aliasing `this` out of a constructor.
 */
const FakeRecognition = function (): Fake {
  const fake: Fake = {
    lang: "",
    interimResults: false,
    continuous: true,
    started: 0,
    stopped: 0,
    aborted: 0,
    onresult: null,
    onspeechend: null,
    onerror: null,
    onend: null,
    start() {
      if (failStart) throw new Error("already started");
      fake.started += 1;
    },
    stop() {
      fake.stopped += 1;
    },
    abort() {
      fake.aborted += 1;
    },
  };
  last = fake;
  return fake;
} as unknown as new () => Fake;

function heard(transcript: string) {
  return { results: [[{ transcript }]] };
}

function setOnline(online: boolean) {
  Object.defineProperty(navigator, "onLine", {
    value: online,
    configurable: true,
  });
}

async function press(name: string | RegExp) {
  await userEvent.click(screen.getByRole("button", { name }));
}

function renderButton(onHeard = vi.fn()) {
  const view = renderWithIntl(<VoiceButton onHeard={onHeard} />);
  return { ...view, onHeard };
}

/** Lets the on-device probe resolve before anything is pressed. */
async function settle() {
  await act(async () => {
    await Promise.resolve();
  });
}

/** Say this engine can transcribe on the device, so nothing need be asked. */
function withOnDeviceRecognition(status = "available") {
  (
    window as unknown as { SpeechRecognition: { available: unknown } }
  ).SpeechRecognition.available = async () => status;
}

beforeEach(() => {
  toastError.mockReset();
  last = null;
  failStart = false;
  setOnline(true);
  (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition =
    FakeRecognition;
  /*
   * Most of what is asserted below is about listening, not about being asked
   * whether to. The cloud recogniser's question is answered once here so those
   * cases reach the microphone; the suite that is *about* the question clears
   * it again.
   */
  writeCloudConsent();
});

afterEach(() => {
  delete (window as unknown as { SpeechRecognition?: unknown })
    .SpeechRecognition;
  forgetCloudConsent();
  vi.useRealTimers();
});

/**
 * The question asked before a sentence spoken in somebody's kitchen is handed
 * to their browser's maker.
 *
 * It is asked once and only where it is true. An engine transcribing on the
 * device carries no such risk, and interrupting that reader to describe one
 * would be a worse feature than never asking at all — so the first assertion
 * here is a silence.
 */
describe("VoiceButton consent", () => {
  beforeEach(() => {
    forgetCloudConsent();
  });

  const ask = () => screen.queryByText("Your voice leaves this device");

  it("asks before sending a voice to a service off the device", async () => {
    renderButton();
    await settle();
    await press("Say it");

    expect(ask()).toBeTruthy();
    // Asked, not yet listening.
    expect(last).toBeNull();
  });

  it("does not ask when the engine transcribes on the device", async () => {
    withOnDeviceRecognition();
    renderButton();
    await settle();
    await press("Say it");

    expect(ask()).toBeNull();
    expect(last?.started).toBe(1);
    expect(last?.processLocally).toBe(true);
  });

  /*
   * A model that is merely downloadable has not been downloaded, so the words
   * would still travel today. Anything short of "available" is asked about.
   */
  it("asks when on-device transcription is only downloadable", async () => {
    withOnDeviceRecognition("downloadable");
    renderButton();
    await settle();
    await press("Say it");

    expect(ask()).toBeTruthy();
    expect(last).toBeNull();
  });

  it("listens once without remembering the answer", async () => {
    const { unmount } = renderButton();
    await settle();
    await press("Say it");
    await press("Listen this once");

    expect(last?.started).toBe(1);
    // Nothing was set locally, so the audio goes the ordinary way.
    expect(last?.processLocally).toBeUndefined();

    // A fresh mount asks again, because nothing was remembered.
    unmount();
    last = null;
    renderButton();
    await settle();
    await press("Say it");

    expect(ask()).toBeTruthy();
    expect(last).toBeNull();
  });

  it("stops asking once told to", async () => {
    const { unmount } = renderButton();
    await settle();
    await press("Say it");
    await press("Listen, and stop asking");

    expect(last?.started).toBe(1);

    unmount();
    last = null;
    renderButton();
    await settle();
    await press("Say it");

    expect(ask()).toBeNull();
    expect(built()?.started).toBe(1);
  });

  it("does not listen when the question is declined", async () => {
    renderButton();
    await settle();
    await press("Say it");
    await press("Don’t listen");

    await waitFor(() => expect(ask()).toBeNull());
    expect(last).toBeNull();
    expect(screen.getByRole("button", { name: "Say it" })).toBeTruthy();
  });
});

describe("VoiceButton availability", () => {
  it("renders nothing where the browser has no recogniser", () => {
    delete (window as unknown as { SpeechRecognition?: unknown })
      .SpeechRecognition;
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  /*
   * Chrome's recogniser is a web service, so offline the button is a control
   * that opens the microphone, listens to a whole sentence and fails. The
   * ordinary form is right there; the shortcut simply is not.
   */
  it("renders nothing while offline", () => {
    setOnline(false);
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("comes back when the network does", async () => {
    setOnline(false);
    renderButton();
    expect(screen.queryByRole("button")).toBeNull();

    setOnline(true);
    window.dispatchEvent(new Event("online"));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Say it" })).toBeTruthy(),
    );
  });

  it("closes a live session when the network drops under it", async () => {
    renderButton();
    await press("Say it");
    expect(last?.started).toBe(1);

    setOnline(false);
    window.dispatchEvent(new Event("offline"));

    await waitFor(() => expect(screen.queryByRole("button")).toBeNull());
    // A button nobody can press is a microphone nobody can close.
    expect(last?.aborted).toBe(1);
  });
});

describe("VoiceButton listening", () => {
  it("listens in a tag with a region on it", async () => {
    renderButton();
    await press("Say it");
    expect(last?.lang).toBe("en-US");
  });

  it("hands the transcript over and stops without waiting to be told", async () => {
    const { onHeard } = renderButton();
    await press("Say it");

    last?.onresult?.(heard("24 francs Coop"));

    expect(onHeard).toHaveBeenCalledWith("24 francs Coop");
    // The engine is asked to close rather than trusted to notice.
    expect(last?.stopped).toBe(1);
  });

  it("stops when speech ends", async () => {
    renderButton();
    await press("Say it");

    last?.onspeechend?.();

    expect(last?.stopped).toBe(1);
  });

  it("takes the microphone back when nothing else ever closes the session", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderButton();
    await press("Say it");
    expect(screen.getByRole("button", { name: "Stop listening" })).toBeTruthy();

    // The engine never fires `end`: this is the bug this ceiling exists for.
    await vi.advanceTimersByTimeAsync(15_000);

    expect(last?.aborted).toBe(1);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Say it" })).toBeTruthy(),
    );
  });

  it("puts the button back when start() throws", async () => {
    failStart = true;
    renderButton();

    await press("Say it");

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Say it" })).toBeTruthy(),
    );
  });
});

describe("VoiceButton failures", () => {
  /*
   * Hearing nothing needs no words: the reader is looking at a form they can
   * still type into, and the button that stopped pulsing has already said it.
   */
  it.each(["no-speech", "aborted"])("says nothing about %s", async (error) => {
    renderButton();
    await press("Say it");

    last?.onerror?.({ error });

    expect(toastError).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Say it" })).toBeTruthy(),
    );
  });

  /*
   * Being refused is not the same as hearing nothing, and a button going
   * quiet cannot tell the two apart. Refusals speak.
   */
  it.each(["not-allowed", "network", "language-not-supported"])(
    "speaks up about %s",
    async (error) => {
      renderButton();
      await press("Say it");

      last?.onerror?.({ error });

      expect(toastError).toHaveBeenCalledWith(
        "Could not listen just now. Type it instead.",
      );
    },
  );

  it("puts the button back after a refusal", async () => {
    renderButton();
    await press("Say it");

    last?.onerror?.({ error: "not-allowed" });

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Say it" })).toBeTruthy(),
    );
  });
});
