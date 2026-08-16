import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  InvalidInvitationError,
  redeemInvitation,
} from "@/lib/security/guest-session";
import { setGuestCookie } from "@/modules/auth/cookies";
import { getDb } from "@/lib/db/client";
import { recordActivity } from "@/modules/activity/service";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";

/**
 * Guest invitation redemption.
 *
 * The token appears in the URL exactly once, for the length of this request:
 *
 *   1. Rate limit by client IP, so a link cannot be brute-forced.
 *   2. Exchange the invitation token for a guest session token.
 *   3. Set the session as an HttpOnly cookie.
 *   4. Redirect (303) to the invite screen, which contains no token.
 *
 * After the redirect the invitation token is not in the address bar, not in
 * history, and not in any referrer sent to a third party. It is never logged:
 * the handler logs the invitation's *id*, resolved after redemption.
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/join/[token]">,
) {
  const { token } = await context.params;
  const env = getEnv();

  const limit = await consumeRateLimit("guestRedeem", await getClientIp());
  if (!limit.allowed) {
    return NextResponse.redirect(
      new URL("/join/error?reason=rate-limited", env.appOrigin),
      { status: 303 },
    );
  }

  try {
    const redeemed = await redeemInvitation(token);

    // Record the join inside the group's history. The token is not part of it.
    await recordActivity(getDb(), {
      groupId: redeemed.context.groupId,
      action: "guest_link.redeemed",
      entityType: "guest_invitation",
      entityId: redeemed.context.invitationId,
      actorType: "guest",
      actorParticipantId: redeemed.context.participantId,
      actorLabel: redeemed.context.displayName,
    });

    await setGuestCookie(redeemed.token, redeemed.expiresAt);

    logger.info(
      {
        groupId: redeemed.context.groupId,
        invitationId: redeemed.context.invitationId,
      },
      "Guest invitation redeemed",
    );

    // 303 so the browser issues a fresh GET to a token-free URL. That URL is
    // the invite screen rather than the group: it is the first thing the guest
    // sees, and it reads the session from the cookie, so the token stops here.
    return NextResponse.redirect(new URL("/invite", env.appOrigin), {
      status: 303,
    });
  } catch (error) {
    if (error instanceof InvalidInvitationError) {
      return NextResponse.redirect(
        new URL("/join/error?reason=invalid", env.appOrigin),
        { status: 303 },
      );
    }
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Guest invitation redemption failed",
    );
    return NextResponse.redirect(
      new URL("/join/error?reason=unavailable", env.appOrigin),
      { status: 303 },
    );
  }
}
