import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { trackRoute } from "@/lib/metrics/http";
import { getCurrentUser } from "@/lib/security/actor";
import { beginConnection } from "@/modules/backup/begin";
import { BackupError } from "@/modules/backup/errors";
import { isOAuthKind, oauthApp, PROVIDER_OF } from "@/modules/backup/oauth";
import { setPendingConnection } from "@/app/api/backup/oauth/cookie";
import { BackupInputError } from "@/modules/backup/service";
import { isUuid } from "@/app/api/mobile";

/**
 * Sends the signed-in person to Google, Dropbox or Microsoft to connect their
 * account as a backup destination, through the app the operator registered for
 * this server.
 *
 * A person who brings their own app does not come here: they paste a client ID
 * and secret, which cannot ride in a link, and an action starts the trip for
 * them (`beginOwnAppConnectionAction`). Both end in the same cookie and the
 * same callback.
 *
 * A GET because it is only a navigation: it changes nothing here, and the two
 * random values it mints are useless to anyone who cannot also read the sealed
 * cookie they are written to.
 *
 * `?reconnect=<destination id>` re-authorises an existing destination instead
 * of adding one, through the app it was connected with. The id is only carried
 * in the cookie; the callback checks that it belongs to the person who comes
 * back.
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

  if (!isOAuthKind(kind)) return back({ connect: "unavailable" });
  // Looked up by this id before anything is sent anywhere, so it has to be one.
  if (reconnect && !isUuid(reconnect)) return back({ connect: "notFound" });

  // A new connection through this link has only the operator's app to use. A
  // reconnect may have its own, which `beginConnection` finds.
  if (!reconnect && !oauthApp(kind)) {
    // A stale bookmark, or the operator has not registered this provider. The
    // screen shows the form for the person's own app in that case, so nobody
    // is lost here.
    return back({ connect: "unavailable" });
  }

  try {
    const { pending, url } = await beginConnection({
      userId: user.userId,
      kind,
      reconnectId: reconnect ?? undefined,
    });
    await setPendingConnection(pending);
    return NextResponse.redirect(url, 303);
  } catch (error) {
    if (error instanceof BackupInputError && error.code === "noKey") {
      return redirectTo("/settings/backup/setup", { step: "key" });
    }
    if (error instanceof BackupError || error instanceof BackupInputError) {
      return back({ connect: error.code });
    }
    throw error;
  }
}
