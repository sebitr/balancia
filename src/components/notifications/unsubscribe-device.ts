/**
 * Taking this browser off push, as part of signing out of it.
 *
 * A push subscription belongs to the browser, not to the session. Before this,
 * signing out left it registered to the account that had turned push on, so
 * that account's notifications — the expense, the amount, who added it — went
 * on arriving on the lock screen of a phone somebody else was now using. And
 * nothing on the server can take it off: a subscription row records the
 * account and the endpoint, and no session, so the server cannot tell which of
 * an account's devices is the one signing out. Only this browser knows its own
 * endpoint. So the browser does it, in two steps, in this order:
 *
 *  1. **The server forgets it**, through the same `DELETE
 *     /api/push/subscriptions` the push switch uses, by endpoint. That needs
 *     the session, which is why sign-out does this before ending it.
 *  2. **The browser unsubscribes**, which kills the endpoint at the push
 *     service. This is the step that actually stops the notifications: if the
 *     first one failed, the server's next send to a dead endpoint is answered
 *     404 or 410, and the row is deleted then (`delivery.ts`).
 *
 * The next person to sign in finds push off on this device and turns it on for
 * themselves if they want it — the settings screen reads the browser's live
 * subscription, not anything remembered (`usePushSubscription`).
 *
 * Never throws, and never waits on a worker that is not there: no service
 * worker, no subscription, a request that fails — none of them is a reason to
 * leave somebody signed in who asked to sign out.
 */
export async function unsubscribeThisDevice(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;

  try {
    await fetch("/api/push/subscriptions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ endpoint: subscription.endpoint }),
    });
  } catch {
    // Left for the next send to prune; see step 2 above.
  }

  try {
    await subscription.unsubscribe();
  } catch {
    // Nothing more this page can do about it.
  }
}

/**
 * This browser's push subscription, if it has one.
 *
 * `getRegistration()` rather than `serviceWorker.ready`: `ready` never settles
 * on a page no worker controls — a development server, plain HTTP, a browser
 * that refused to install it — and sign-out would hang on it. A subscription
 * belongs to a registration, so no registration means no subscription.
 */
async function currentSubscription(): Promise<PushSubscription | null> {
  try {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return null;
    }
    const registration = await navigator.serviceWorker.getRegistration();
    return (await registration?.pushManager?.getSubscription()) ?? null;
  } catch {
    return null;
  }
}
