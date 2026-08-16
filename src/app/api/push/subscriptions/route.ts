import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getClientIp, getCurrentUser } from "@/lib/security/actor";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { logger } from "@/lib/logger";
import { isPushConfigured } from "@/lib/push/send";
import { trackRoute } from "@/lib/metrics/http";
import {
  deleteSubscription,
  InvalidSubscriptionError,
  saveSubscription,
  subscriptionInputSchema,
} from "@/modules/notifications/subscriptions";

/**
 * Registering and forgetting a device for push.
 *
 * Signed-in users only. A guest is a link holder with no account: there is
 * nothing to attach a device to, and nothing to stop the next link holder from
 * inheriting the previous one's notifications.
 */

const postSchema = z.object({
  subscription: subscriptionInputSchema,
  /**
   * The endpoint this one replaces, when the browser rotated it. Removed as
   * well as the new one being stored, so a rotation does not leave a dead row
   * behind that the worker keeps trying.
   */
  previousEndpoint: z.string().max(2048).nullish(),
});

const deleteSchema = z.object({
  endpoint: z.string().min(1).max(2048),
});

export async function POST(request: Request) {
  return trackRoute("/api/push/subscriptions", "POST", () =>
    handlePost(request),
  );
}

async function handlePost(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
  }

  if (!isPushConfigured()) {
    return NextResponse.json(
      { error: "Push notifications are not configured on this instance." },
      { status: 503 },
    );
  }

  const limit = await consumeRateLimit("pushSubscribe", await getClientIp());
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(limit.retryAfterSeconds) },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid subscription." },
      { status: 400 },
    );
  }

  try {
    if (parsed.data.previousEndpoint) {
      await deleteSubscription(user.userId, parsed.data.previousEndpoint);
    }
    await saveSubscription(user.userId, parsed.data.subscription, {
      userAgent: (await headers()).get("user-agent"),
    });
  } catch (error) {
    if (error instanceof InvalidSubscriptionError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    // Never log the endpoint: it is a capability to send to someone's device.
    logger.error(
      { err: error instanceof Error ? error.message : String(error) },
      "Could not store a push subscription",
    );
    return NextResponse.json(
      { error: "That device could not be registered." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(request: Request) {
  return trackRoute("/api/push/subscriptions", "DELETE", () =>
    handleDelete(request),
  );
}

async function handleDelete(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to continue." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  // Scoped to the caller inside the query, so knowing an endpoint is not
  // enough to unsubscribe somebody else.
  const removed = await deleteSubscription(user.userId, parsed.data.endpoint);
  return NextResponse.json({ ok: true, removed });
}
