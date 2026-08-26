"use server";

import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getClientIp } from "@/lib/security/actor";
import { consumeRateLimit, RateLimitedError } from "@/lib/security/rate-limit";
import { getEnv } from "@/lib/env";
import { setSessionCookie } from "@/modules/auth/cookies";
import { startDemoSession } from "./sessions";

/**
 * Entering the demo.
 *
 * One action behind both ways in — the button on the sign-in page and typing
 * `demo` / `demo` into the form — so there is one place that decides what a
 * demo visitor gets.
 */
export async function startDemoAction(): Promise<ActionResult> {
  if (!getEnv().DEMO_MODE) {
    // Not an error worth explaining. On a real instance this action is
    // reachable and does nothing, which is the behaviour that matters.
    const t = await getTranslations("serverErrors");
    return actionError(t("generic"));
  }

  const requestHeaders = await headers();
  const ipAddress = await getClientIp();

  return runAction("demo.start", async () => {
    /*
     * Rate limited on the sign-in bucket like any other credential. Each call
     * writes a couple of hundred rows into the in-memory database, so this is
     * what stands between the demo and one script exhausting the process's
     * memory — the concurrency cap in sessions.ts is the second line.
     */
    const limit = await consumeRateLimit("signIn", ipAddress);
    if (!limit.allowed) {
      throw new RateLimitedError(limit.retryAfterSeconds);
    }

    const { session } = await startDemoSession({
      userAgent: requestHeaders.get("user-agent"),
      ipAddress,
    });
    await setSessionCookie(session.token, session.expiresAt);
  });
}
