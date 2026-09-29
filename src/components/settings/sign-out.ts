import { forgetDevice } from "@/lib/offline/forget";
import { signOutAction } from "@/modules/auth/actions";

/**
 * What signing out does on this side of the network, in the order it happens.
 *
 * 1. **The device forgets.** The worker's page cache and the offline database
 *    are deleted (see `forget.ts`). First, because it is local and cannot fail
 *    on a bad connection, and because it is the part nobody can do for the
 *    person later: once the phone has been handed over, whatever is still on
 *    it is the next person's to read.
 * 2. **The session ends, with the header.** `DELETE /api/auth/session` revokes
 *    the session and clears the cookie, and its answer carries
 *    `Clear-Site-Data: "cache"` for the browser's own HTTP cache. That header
 *    is why this request exists at all: a Server Action cannot set one.
 * 3. **The Server Action, as before.** By now there is usually no cookie left
 *    for it to revoke, and what it contributes is the redirect — to the
 *    homepage, or wherever a demo sends people — along with the router-cache
 *    purge Next performs after any action that writes a cookie. If step 2
 *    never reached the server, this is the step that ends the session.
 */
export async function signOut(): Promise<void> {
  await leaveDevice();
  await signOutAction();
}

/**
 * Steps 1 and 2 on their own, for a closed account: the session has already
 * gone with it, and the route answers the same without one.
 */
export async function leaveDevice(): Promise<void> {
  await forgetDevice();
  try {
    await fetch("/api/auth/session", {
      method: "DELETE",
      credentials: "same-origin",
    });
  } catch {
    // No network. On a sign-out the Server Action that follows needs one too,
    // and fails on its own; what is lost here is only the header, and the
    // device's own stores are already gone.
  }
}
