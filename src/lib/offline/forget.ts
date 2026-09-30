import { deleteOfflineDatabase } from "./idb";

/**
 * Taking this device's copy of somebody off it, when they sign out.
 *
 * A phone is often somebody else's next: a partner's, a flatmate's, the one
 * left on the table at the end of a trip. Ending the session on the server is
 * not the end of what the device holds about the person who just left, and
 * two things here would otherwise outlive them:
 *
 *  - **The page cache.** The service worker keeps every screen it has served
 *    in `balancia-pages`, so that a signal dropping out does not blank the
 *    one somebody is looking at. Those are server-rendered pages: balances,
 *    names, amounts. Left in place, the next person could read them with the
 *    radio off, or after the five seconds the worker waits for a server.
 *  - **The offline database.** Group snapshots name every member of every
 *    group opened; drafts are half-typed amounts; the outbox is expenses not
 *    yet sent; a share may be a photographed receipt. All of it is deleted.
 *
 * Only those. The build output, icons and the optional model files are the
 * same bytes for everybody and are expensive to fetch again; the precache
 * holds the offline screen, which knows nobody. And the service worker itself
 * stays registered — see `docs/offline.md` for why the sign-out response does
 * not ask the browser for `Clear-Site-Data: "storage"`, which would take it.
 * Its push subscription is the one thing on it that is somebody's, and
 * sign-out removes that separately, server included (`unsubscribeThisDevice`).
 *
 * Entries still in the outbox are lost with it. The sign-out sheet says how
 * many before anybody confirms (see `SignOutSheet`).
 */

/**
 * The cache the worker keeps navigations in. Named here rather than in the
 * worker so that the code deleting it and the code filling it cannot drift
 * apart on a rename.
 */
export const PAGES_CACHE = "balancia-pages";

/**
 * Forgets everything this device holds for the person on it.
 *
 * Never throws, and settles even where a store is missing: a browser with no
 * Cache Storage (plain HTTP, where the worker never ran) has nothing in one to
 * delete, and a sign-out that failed because the cleanup did would leave the
 * person signed in on a device they meant to hand over.
 */
export async function forgetDevice(): Promise<void> {
  await Promise.all([forgetPages(), deleteOfflineDatabase()]);
}

async function forgetPages(): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await caches.delete(PAGES_CACHE);
  } catch {
    // A Cache Storage the browser will not open holds nothing to delete.
  }
}
