import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/push/send";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The VAPID public key browsers need to subscribe.
 *
 * Public by definition: it is embedded in every subscription and handed to the
 * push service on every message. It is served as its own endpoint rather than
 * only being passed into the settings page because the service worker needs it
 * too, when a push service rotates an endpoint and it has to re-subscribe with
 * no page open.
 *
 * `publicKey: null` means this instance has push switched off — the settings
 * page reads that as "offer in-app notifications only".
 */
export async function GET() {
  return trackRoute("/api/push/key", "GET", () => handleGet());
}

async function handleGet() {
  const keys = getVapidKeys();
  return NextResponse.json(
    { publicKey: keys?.publicKey ?? null },
    {
      headers: {
        // Deliberately not cached, though the value is public and rarely
        // changes. This answer decides whether the settings page offers push
        // at all, so a cached "null" would go on claiming the instance has no
        // keys for an hour after an operator finished configuring them —
        // exactly when someone is reloading to check their work.
        "Cache-Control": "no-store",
      },
    },
  );
}
