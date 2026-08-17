import { NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import { verifyEmail } from "@/modules/auth/service";

/**
 * The link registration mails out.
 *
 * A route handler rather than a page, for the same reason /join/[token] is
 * one: the token has to be spent exactly once, and a render is not a
 * guarantee of that — React may run it twice, and a prefetch may run it
 * without anybody having clicked. A GET that consumes and then redirects (303)
 * happens once, and leaves the token out of the address bar afterwards.
 */
export async function GET(request: Request) {
  const env = getEnv();
  const token = new URL(request.url).searchParams.get("token");

  const verified = token ? await verifyEmail(token) : false;
  if (!verified) {
    logger.info("Email verification link was invalid, expired or already used");
    return NextResponse.redirect(
      new URL("/sign-in?error=confirmLinkInvalid", env.appOrigin),
      { status: 303 },
    );
  }

  return NextResponse.redirect(new URL("/sign-in?verified=1", env.appOrigin), {
    status: 303,
  });
}
