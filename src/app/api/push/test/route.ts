import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { isPushConfigured, sendPush } from "@/lib/push/send";
import { listPushTargets } from "@/modules/notifications/subscriptions";
import { trackRoute } from "@/lib/metrics/http";

/**
 * Sends a test notification to the caller's own devices.
 *
 * The one place a push message is sent from a request rather than the worker,
 * because the point of it is to answer "did that work?" while somebody is
 * looking at the screen. It can only ever reach the caller's own devices.
 */
export async function POST() {
  return trackRoute("/api/push/test", "POST", () => handlePost());
}

async function handlePost() {
  const tErrors = await getTranslations("serverErrors");

  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: tErrors("authRequired") },
      { status: 401 },
    );
  }

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: tErrors("pushNotConfigured") },
      { status: 503 },
    );
  }

  const limit = await consumeRateLimit("pushTest", user.userId);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: tErrors("pushTestRateLimited") },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  const devices = await listPushTargets(user.userId);
  if (devices.length === 0) {
    return NextResponse.json(
      { error: tErrors("deviceNotSubscribed") },
      { status: 409 },
    );
  }

  const t = await getTranslations("notificationSettings");
  const payload = JSON.stringify({
    title: "Balancia",
    body: t("testBody"),
    url: "/notifications",
    tag: "balancia-test",
    notificationId: "test",
  });

  const outcomes = await Promise.all(
    devices.map((device) => sendPush(device, payload, { topic: "test" })),
  );
  const sent = outcomes.filter((outcome) => outcome.status === "sent").length;

  if (sent === 0) {
    return NextResponse.json(
      { error: tErrors("pushTestFailed") },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, sent });
}
