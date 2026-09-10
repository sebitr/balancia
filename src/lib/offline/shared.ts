import { SHARE_STORE, idbDelete, idbGet, idbPut } from "./idb";

/**
 * What another app just handed over, between the worker that caught it and the
 * screen that turns it into an entry.
 *
 * A Web Share Target arrives as a **POST**, which is the whole reason this
 * store exists. A POST cannot be a page: navigating to the result would leave
 * a form submission in the history that the back button re-submits, and — the
 * part no query string can solve — a shared photograph is a `File`, which
 * cannot travel in a URL at all. So the service worker takes the POST, puts
 * what it holds here, and answers with a redirect to a plain GET. The screen
 * picks it up on the other side.
 *
 * Three decisions, each of them about not keeping somebody's data:
 *
 *  - **One at a time.** A second share replaces the first. Two receipts
 *    waiting to be filed is a queue, and a queue is a second inbox nobody
 *    asked for; the person is standing there having just shared something, and
 *    that something is the one that matters.
 *  - **Taken, not read.** `takeSharedPayload` deletes as it answers, so a
 *    reload of the screen does not file the same receipt twice, and the
 *    photograph does not sit in the browser after it has been used.
 *  - **Stale after an hour.** A share is a thing somebody did just now. One
 *    abandoned at the group picker is not worth restoring next Tuesday, and it
 *    is a receipt with somebody's card details on it sitting in a store.
 *
 * Every function answers rather than throws, like the rest of `lib/offline` —
 * a device that refuses IndexedDB simply never has a share to read, and lands
 * on the empty state.
 */

/** One hour, in milliseconds. */
export const SHARE_TTL_MS = 60 * 60 * 1000;

/** There is only ever one, so it has only ever one key. */
const SHARE_KEY = "incoming";

export interface SharedPayload {
  readonly id: string;
  /** When the worker took the POST. Used only to expire it. */
  readonly sharedAt: number;
  /**
   * The three text fields the share target declares, as the sharing app filled
   * them in. Which one holds the useful sentence is anybody's guess — a chat
   * app puts the message in `text`, a browser puts the page title in `title`
   * and the address in `url` — so all three are kept and `sharedText` decides.
   */
  readonly title: string;
  readonly text: string;
  readonly url: string;
  /** A receipt: a photograph, a screenshot, or a PDF invoice. */
  readonly file: File | null;
}

export async function saveSharedPayload(
  payload: Omit<SharedPayload, "id">,
): Promise<void> {
  await idbPut(SHARE_STORE, { ...payload, id: SHARE_KEY });
}

/**
 * The waiting share, if there is a fresh one — and it is gone once read.
 *
 * Deleting before answering rather than after is deliberate: a screen that
 * crashes between the two would otherwise be handed the same receipt on every
 * reload, and the failure mode of losing a share is somebody sharing it again,
 * while the failure mode of keeping one is a receipt that will not go away.
 */
export async function takeSharedPayload(
  now: number = Date.now(),
): Promise<SharedPayload | null> {
  const payload = await idbGet<SharedPayload>(SHARE_STORE, SHARE_KEY);
  await idbDelete(SHARE_STORE, SHARE_KEY);
  if (!payload) return null;
  return isFresh(payload, now) ? payload : null;
}

/** Whether a share is recent enough to still be the thing somebody meant. */
export function isFresh(payload: SharedPayload, now: number): boolean {
  const age = now - payload.sharedAt;
  // A negative age is a clock that moved backwards rather than a share from
  // the future, and throwing away a receipt over it would be the wrong call.
  return age < SHARE_TTL_MS;
}

/**
 * The one sentence worth parsing out of what arrived.
 *
 * Sharing apps disagree about which field is the message. A chat app shares
 * the selected message as `text`; a browser shares the page's title as `title`
 * and its address as `url`; some put the address in `text` and nothing else
 * anywhere. So the rule is the simplest one that is right in all three cases:
 * take `text` when it says something, fall back to `title`, and never take
 * `url`.
 *
 * `url` is excluded rather than appended because a URL is not a sentence about
 * money. Run "https://www.migros.ch/de/product/12345" through the parser and
 * the 12345 is an amount — a hundred and twenty-three francs nobody spent,
 * filed against a description of a web address. A share that carries only a
 * link therefore opens an empty drawer, which is the honest outcome: nothing
 * in it said what was bought.
 */
export function sharedText(payload: SharedPayload): string {
  const text = payload.text.trim();
  if (text !== "" && !isJustAUrl(text)) return text;
  const title = payload.title.trim();
  return isJustAUrl(title) ? "" : title;
}

function isJustAUrl(value: string): boolean {
  return /^https?:\/\/\S+$/i.test(value);
}
