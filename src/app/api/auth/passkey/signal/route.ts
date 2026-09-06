import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { passkeySignalState } from "@/modules/auth/webauthn";
import { getEnv } from "@/lib/env";
import { trackRoute } from "@/lib/metrics/http";

/**
 * What the browser needs to keep a password manager's list honest.
 *
 * The sign-in and delete routes answer with this inline, because both already
 * know it and both are followed by a navigation there is no time to race. This
 * route is for the third case: something changed about the *account* rather
 * than its credentials — a new display name, a confirmed address — and the
 * passkey entries are still captioned with the old one.
 *
 * It is a read of the caller's own account and nothing else. The name and
 * address in the answer are the ones the reader is already looking at.
 */
export async function GET() {
  return trackRoute("/api/auth/passkey/signal", "GET", () => handleGet());
}

async function handleGet() {
  const user = await getCurrentUser();
  if (!user) {
    const t = await getTranslations("serverErrors");
    return NextResponse.json({ error: t("authRequired") }, { status: 401 });
  }

  const signal = await passkeySignalState(user.userId);
  return NextResponse.json(
    { rpId: getEnv().webAuthnRpId, signal },
    { headers: { "Cache-Control": "no-store" } },
  );
}
