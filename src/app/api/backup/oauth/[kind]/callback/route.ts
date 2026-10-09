import { NextResponse } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { trackRoute } from "@/lib/metrics/http";
import { getCurrentUser } from "@/lib/security/actor";
import { takePendingConnection } from "@/app/api/backup/oauth/cookie";
import { completeConnection } from "@/modules/backup/connect";
import { BackupError } from "@/modules/backup/errors";
import { isOAuthKind, PROVIDER_OF } from "@/modules/backup/oauth";
import { sameState } from "@/modules/backup/oauth-state";
import { BackupInputError } from "@/modules/backup/service";
import { isUuid } from "@/app/api/mobile";

/**
 * Where Google, Dropbox or Microsoft sends the person back.
 *
 * Nothing in the query string is trusted. The code is worthless without the
 * PKCE verifier and the client secret, one in a cookie only this browser holds
 * and the other only this server knows. The `state` must match the sealed
 * cookie, the cookie must belong to the person now signed in, and the cookie is
 * burned on read — so a link replayed later, or opened in another session,
 * finds nothing to complete.
 *
 * Every outcome is a redirect with one short word saying what happened. The
 * screen words it; no provider text is passed along. A new connection goes back
 * to step 3 of the wizard, which shows who connected and carries on to step 4; a
 * reconnection goes back to the overview.
 */

const querySchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
});

function redirectTo(path: string, params: Record<string, string>) {
  const url = new URL(path, getEnv().appOrigin);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return NextResponse.redirect(url, 303);
}

export async function GET(
  request: Request,
  context: RouteContext<"/api/backup/oauth/[kind]/callback">,
) {
  return trackRoute("/api/backup/oauth/[kind]/callback", "GET", () =>
    handleGet(request, context),
  );
}

async function handleGet(
  request: Request,
  context: RouteContext<"/api/backup/oauth/[kind]/callback">,
) {
  // Single-use whatever happens next.
  const pending = await takePendingConnection();

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(new URL("/sign-in", getEnv().appOrigin), 303);
  }

  const { kind } = await context.params;
  const reconnecting = Boolean(pending?.reconnectId);

  /** Back to wherever the person was: the wizard's step 3, or the overview. */
  const back = (params: Record<string, string>) =>
    reconnecting || !isOAuthKind(kind)
      ? redirectTo("/settings/backup", params)
      : redirectTo("/settings/backup/setup", {
          step: "connect",
          provider: PROVIDER_OF[kind],
          ...params,
        });

  const query = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return back({ connect: "failed" });

  if (query.data.error) {
    // `access_denied` is someone pressing Cancel on the provider's page. The
    // wizard draws that as a quiet "access wasn't allowed", not as an error.
    if (query.data.error === "access_denied")
      return back({ connect: "denied" });
    logger.warn(
      { kind, reason: query.data.error },
      "A backup provider returned an authorization error",
    );
    return back({ connect: "failed" });
  }

  if (
    !pending ||
    !isOAuthKind(kind) ||
    pending.kind !== kind ||
    pending.userId !== user.userId ||
    !query.data.state ||
    !sameState(pending.state, query.data.state) ||
    !query.data.code
  ) {
    logger.warn(
      { kind, hadCookie: pending !== null },
      "A backup callback did not match a pending connection",
    );
    return back({ connect: "expired" });
  }

  try {
    const connected = await completeConnection({
      userId: user.userId,
      kind,
      code: query.data.code,
      verifier: pending.verifier,
      reconnectId:
        pending.reconnectId && isUuid(pending.reconnectId)
          ? pending.reconnectId
          : undefined,
      app: pending.app,
    });
    return back(
      connected.reconnected
        ? { reconnected: "1" }
        : { connected: connected.destinationId },
    );
  } catch (error) {
    if (error instanceof BackupError) {
      logger.warn(
        { kind, code: error.code },
        "Connecting a backup provider failed",
      );
      return back({ connect: error.code });
    }
    if (error instanceof BackupInputError) {
      return back({ connect: error.code });
    }
    throw error;
  }
}
