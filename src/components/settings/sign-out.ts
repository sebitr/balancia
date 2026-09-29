import { forgetDevice } from "@/lib/offline/forget";
import { unsubscribeThisDevice } from "@/components/notifications/unsubscribe-device";
import { signOutAction } from "@/modules/auth/actions";

/**
 * What signing out does on this side of the network, in the order it happens.
 *
 * 1. **The device forgets.** The worker's page cache and the offline database
 *    are deleted (see `forget.ts`). First, because it is local and cannot fail
 *    on a bad connection, and because it is the part nobody can do for the
 *    person later: once the phone has been handed over, whatever is still on
 *    it is the next person's to read.
 * 2. **Push stops.** The server forgets this browser's subscription and the
 *    browser unsubscribes, so the account's notifications stop arriving on a
 *    device somebody else may be holding (see `unsubscribeThisDevice`). Before
 *    step 3, because the server's half is done as the signed-in account and
 *    needs the session that step 3 ends.
 * 3. **The session ends, with the header.** `DELETE /api/auth/session` revokes
 *    the session and clears the cookie, and its answer carries
 *    `Clear-Site-Data: "cache"` for the browser's own HTTP cache. That header
 *    is why this request exists at all: a Server Action cannot set one.
 * 4. **The Server Action, as before.** By now there is usually no cookie left
 *    for it to revoke, and what it contributes is the redirect — to the
 *    homepage, or wherever a demo sends people — along with the router-cache
 *    purge Next performs after any action that writes a cookie. If step 3
 *    never reached the server, this is the step that ends the session.
 *
 * None of steps 1 to 3 throws. A failure in any of them costs what that step
 * was for and nothing else; it never leaves somebody signed in who asked not
 * to be.
 */
export async function signOut(): Promise<void> {
  await leaveDevice();
  await signOutAction();
}

/**
 * Steps 1 to 3 on their own, for a closed account.
 *
 * The session has already gone with the account there, and so have its push
 * rows — they are deleted with the user — so the server's half of step 2
 * answers 401 and changes nothing. The browser's half is the one that matters:
 * without it the endpoint stays live at the push service. The session route
 * answers the same without a session, and still carries the header.
 */
export async function leaveDevice(): Promise<void> {
  await forgetDevice();
  await unsubscribeThisDevice();
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
