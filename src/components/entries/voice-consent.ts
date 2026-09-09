/**
 * Whether the reader's voice may leave the device, and whether it has to.
 *
 * The receipt scanner reads frames on the device and says so. Dictation is not
 * the same shape: Chrome's recogniser is a web service by default — "your
 * audio is sent to a web service for recognition processing, so it won't work
 * offline" — so pressing the button ships a sentence spoken in somebody's
 * kitchen to their browser vendor. That is a thing to be asked about once,
 * not a thing to discover.
 *
 * Newer engines can transcribe on the device instead. Where they can, there
 * is nothing to ask: the audio never goes anywhere, so the reader is never
 * interrupted. The question exists only for the path that leaves.
 */

/**
 * The on-device half of the Web Speech API, which TypeScript's DOM library
 * does not describe. `available` answers for a set of languages; only
 * "available" means the model is on the device *now* — "downloadable" and
 * "downloading" both still mean the words would travel today.
 */
export interface LocalCapableRecognition {
  available?(options: {
    langs: string[];
    processLocally: boolean;
  }): Promise<string>;
}

/** Remembers a reader who has said they do not want asking again. */
const CONSENT_KEY = "balancia:voice-cloud-consent";

/**
 * localStorage throws rather than no-ops in some privacy modes, and a reader
 * who cannot store a preference should be asked again rather than refused.
 */
export function readCloudConsent(): boolean {
  try {
    return window.localStorage.getItem(CONSENT_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeCloudConsent(): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, "1");
  } catch {
    // A consent we cannot persist still holds for this session.
  }
}

/** Test seam, and the way a reader could be given the question back. */
export function forgetCloudConsent(): void {
  try {
    window.localStorage.removeItem(CONSENT_KEY);
  } catch {
    // Nothing stored is nothing to clear.
  }
}

/**
 * Whether this engine can transcribe the language on the device right now.
 *
 * Anything other than a plain "available" is treated as no: a model that is
 * merely downloadable is one that has not been downloaded, and asking the
 * reader to wait for it is a different feature. `available` is absent on every
 * engine that predates on-device recognition, which is most of them.
 */
export async function canProcessLocally(
  Recognition: LocalCapableRecognition,
  lang: string,
): Promise<boolean> {
  if (typeof Recognition.available !== "function") return false;
  try {
    const status = await Recognition.available({
      langs: [lang],
      processLocally: true,
    });
    return status === "available";
  } catch {
    // An engine that cannot answer is one we cannot promise anything about.
    return false;
  }
}
