import { getEnv } from "@/lib/env";
import { noStore } from "@/app/api/mobile";
import { trackRoute } from "@/lib/metrics/http";

/**
 * The ways into an account this instance offers.
 *
 * The web's sign-in page knows these at render time — `smtpEnabled` decides
 * whether "Email me a sign-in code" is drawn at all, `appleSignInEnabled`
 * whether the Apple button is — and hides what cannot work rather than
 * offering a button that fails. A native client has no render time on the
 * server, and the instance it is pointed at may be anybody's, so it asks
 * here before laying out its screen.
 *
 * Nothing in the answer is secret: every value is already visible to anyone
 * who loads the sign-in page. Anonymous on purpose, for the same reason the
 * page is.
 *
 * `passkey` is true wherever the instance is, because the relying party is
 * always configured; whether a *device* can hold one is the client's own
 * question. `password` is here so that the shape can one day say no.
 */
export async function GET() {
  return trackRoute("/api/auth/options", "GET", handleGet);
}

async function handleGet() {
  const env = getEnv();
  return noStore({
    password: true,
    // The demo instance signs in with a fixed credential and mails nobody.
    code: env.smtpEnabled && !env.DEMO_MODE,
    passkey: true,
    apple: env.appleSignInEnabled,
  });
}
