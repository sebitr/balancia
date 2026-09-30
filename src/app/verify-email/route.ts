import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { getClientIp } from "@/lib/security/actor";
import {
  clearRegistrationCookie,
  isRegistrationBrowser,
} from "@/modules/auth/cookies";
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
 * Spending it always confirms the address. It signs the person in only in the
 * browser that registered — the one carrying the registration cookie for this
 * very account. There, the link is the last step of a sign-up already under
 * way: the proof a password reset turns into a session and the six-digit code
 * turns into one on the spot, and landing them on an empty sign-in form would
 * ask for it twice. The session is settled the same way every other new one
 * is, so a guest cookie in this browser is claimed and the link lands on what
 * that kept.
 *
 * Anywhere else the link is only a URL somebody had, and it may not be the
 * person who registered: settling a session there would hand the opener's
 * guest seat to whoever sent it (registration-browser.ts has the whole
 * attack). So a stranger's browser is told the address is confirmed and asked
 * to sign in, which only the account's owner can do.
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

  if (!(await isRegistrationBrowser(verified.userId))) {
    logger.info(
      "Email verified from a browser that did not register the account; not signing in",
    );
    return NextResponse.redirect(
      new URL("/sign-in?verified=1", env.appOrigin),
      { status: 303 },
    );
  }
  await clearRegistrationCookie();

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
