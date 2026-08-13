import { NextResponse } from "next/server";
import { getVapidKeys } from "@/lib/push/send";

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
export function GET() {
  const keys = getVapidKeys();
  return NextResponse.json(
    { publicKey: keys?.publicKey ?? null },
    {
      headers: {
        // Same for everyone and changes only when an operator rotates it.
        "Cache-Control": "public, max-age=3600",
      },
    },
  );
}
