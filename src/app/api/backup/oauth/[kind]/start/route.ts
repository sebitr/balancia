import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { trackRoute } from "@/lib/metrics/http";
import { getCurrentUser } from "@/lib/security/actor";
import { BackupError } from "@/modules/backup/errors";
import {
  buildAuthorizeUrl,
  challengeFor,
  isOAuthKind,
  oauthApp,
  PROVIDER_OF,
  randomToken,
} from "@/modules/backup/oauth";
import { setPendingConnection } from "@/app/api/backup/oauth/cookie";
import { ttlExpiry } from "@/modules/backup/oauth-state";
import { getBackupKey } from "@/modules/backup/service";

/**
 * Sends the signed-in person to Google, Dropbox or Microsoft to connect their
 * account as a backup destination.
 *
 * A GET because it is only a navigation: it changes nothing here, and the two
 * random values it mints are useless to anyone who cannot also read the sealed
 * cookie they are written to.
 *
 * `?reconnect=<destination id>` re-authorises an existing destination instead
 * of adding one. The id is only carried in the cookie; the callback checks
 * that it belongs to the person who comes back.
 */

function redirectTo(path: string, params: Record<string, string> = {}) {
  const url = new URL(path, getEnv().appOrigin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/backup/oauth/[kind]/start">,
) {
  return trackRoute("/api/backup/oauth/[kind]/start", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/backup/oauth/[kind]/start">,
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", getEnv().appOrigin), 303);
  }

  const { kind } = await context.params;
  const reconnect = new URL(request.url).searchParams.get("reconnect");

  /** Back to the wizard's first step, or the overview if this was a reconnect. */
  const back = (params: Record<string, string> = {}) =>
    reconnect || !isOAuthKind(kind)
      ? redirectTo("/settings/backup", params)
      : redirectTo("/settings/backup/setup", {
          step: "connect",
          provider: PROVIDER_OF[kind],
          ...params,
        });

  if (!isOAuthKind(kind) || !oauthApp(kind)) {
    // A stale bookmark, or the operator has not registered this provider. The
    // screen does not draw the button in that case, so nobody is lost here.
    return back({ connect: "unavailable" });
  }

  // A connection with nothing to encrypt to would be refused on its first run.
  if (!(await getBackupKey(user.userId))) {
    return redirectTo("/settings/backup/setup", { step: "key" });
  }

  const state = randomToken();
  const verifier = randomToken(48);
  await setPendingConnection({
    kind,
    state,
    verifier,
    userId: user.userId,
    reconnectId: reconnect ?? undefined,
    expiresAt: ttlExpiry(),
  });

  try {
    return NextResponse.redirect(
      buildAuthorizeUrl(kind, { state, challenge: challengeFor(verifier) }),
      303,
    );
  } catch (error) {
    if (error instanceof BackupError) return back({ connect: error.code });
    throw error;
  }
}
