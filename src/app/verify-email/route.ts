import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/security/actor";
import { verifyEmail } from "@/modules/auth/service";
import { settleNewSession } from "@/modules/auth/session-handoff";
import { createSession } from "@/modules/auth/sessions";

/**
 * The link registration mails out.
 *
 * A route handler rather than a page, for the same reason /join/[token] is
 * one: the token has to be spent exactly once, and a render is not a
 * guarantee of that — React may run it twice, and a prefetch may run it
 * without anybody having clicked. A GET that consumes and then redirects (303)
 * happens once, and leaves the token out of the address bar afterwards.
 *
 * Spending it signs the person in. The link proved control of the inbox, which
 * is the proof a password reset already turns into a session and the proof
 * the six-digit code turns into one on the spot; landing them on an empty
 * sign-in form afterwards asked them to prove it a second time, and to type
 * the address they had just confirmed. The session is settled the same way
 * every other new one is, so a guest cookie in this browser is claimed and the
 * link lands on what that kept.
 */
export async function GET(request: Request) {
  const env = getEnv();
  const token = new URL(request.url).searchParams.get("token");

  const verified = token ? await verifyEmail(token) : null;
  if (!verified) {
    logger.info("Email verification link was invalid, expired or already used");
    return NextResponse.redirect(
      new URL("/sign-in?error=confirmLinkInvalid", env.appOrigin),
      { status: 303 },
    );
  }

  const session = await createSession(verified.userId, {
    userAgent: request.headers.get("user-agent"),
    ipAddress: await getClientIp(),
  });
  const settled = await settleNewSession(verified.userId, session, {});

  const destination = settled.claimedGroupId
    ? `/register/done?group=${settled.claimedGroupId}`
    : "/dashboard";
  return NextResponse.redirect(new URL(destination, env.appOrigin), {
    status: 303,
  });
}
