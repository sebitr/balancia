import "server-only";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { pushSubscriptions } from "@/lib/db/schema";
import {
  AUTH_SECRET_BYTES,
  decodeFixed,
  decodePublicKey,
  PushKeyError,
} from "@/lib/push/keys";

/**
 * The devices one account has agreed to be notified on.
 *
 * A subscription arrives from the browser and is therefore untrusted input:
 * the endpoint decides where this server will later send an HTTP request, so
 * it is validated as strictly as anything else that steers an outbound call.
 */

/** Nothing here is secret to the user, but all of it is specific to them. */
export interface DeviceSummary {
  readonly id: string;
  readonly userAgent: string | null;
  readonly createdAt: Date;
  readonly lastSuccessAt: Date | null;
}

/**
 * Validates the shape the Push API produces.
 *
 * The endpoint must be an absolute HTTPS URL. Anything else — a relative path,
 * `http:`, `file:`, or a URL pointing at a private address — would turn this
 * table into a server-side request forgery primitive, since the worker POSTs
 * to whatever is stored here.
 */
export const subscriptionInputSchema = z.object({
  endpoint: z
    .string()
    .url("A push endpoint must be an absolute URL")
    .max(2048, "That push endpoint is implausibly long")
    .refine(
      (value) => value.startsWith("https://"),
      "A push endpoint must use HTTPS",
    ),
  keys: z.object({
    p256dh: z.string().min(1).max(200),
    auth: z.string().min(1).max(100),
  }),
});

export type SubscriptionInput = z.infer<typeof subscriptionInputSchema>;

export class InvalidSubscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSubscriptionError";
  }
}

/**
 * Stores a subscription against an account.
 *
 * Keyed on the endpoint, which is globally unique per device: re-subscribing
 * in the same browser updates the row, and a device that changes hands moves
 * to the new account rather than notifying the previous one. Both are
 * conflict cases the unique index turns into an upsert.
 */
export async function saveSubscription(
  userId: string,
  input: SubscriptionInput,
  options: { db?: Database; userAgent?: string | null } = {},
): Promise<void> {
  // Reject key material the encryption step would choke on later, while there
  // is still someone on the other end of the request to be told.
  try {
    decodePublicKey(input.keys.p256dh, "Subscription key");
    decodeFixed(input.keys.auth, AUTH_SECRET_BYTES, "Subscription auth secret");
  } catch (error) {
    throw new InvalidSubscriptionError(
      error instanceof PushKeyError
        ? error.message
        : "That push subscription is not usable.",
    );
  }

  const db = options.db ?? getDb();
  const values = {
    userId,
    endpoint: input.endpoint,
    p256dh: input.keys.p256dh,
    auth: input.keys.auth,
    userAgent: options.userAgent?.slice(0, 200) ?? null,
    failureCount: 0,
  };

  await db
    .insert(pushSubscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: pushSubscriptions.endpoint,
      set: {
        userId: values.userId,
        p256dh: values.p256dh,
        auth: values.auth,
        userAgent: values.userAgent,
        failureCount: 0,
      },
    });
}

/**
 * Forgets one device. Scoped by user in the same statement, so knowing
 * somebody else's endpoint does not let you unsubscribe them.
 */
export async function deleteSubscription(
  userId: string,
  endpoint: string,
  options: { db?: Database } = {},
): Promise<boolean> {
  const db = options.db ?? getDb();
  const rows = await db
    .delete(pushSubscriptions)
    .where(
      and(
        eq(pushSubscriptions.userId, userId),
        eq(pushSubscriptions.endpoint, endpoint),
      ),
    )
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

/**
 * The material needed to actually send to someone's devices.
 *
 * Separate from `listSubscriptions` on purpose: the endpoint is a capability
 * to send to a device, so it leaves this module only towards the sender, never
 * towards a page.
 */
export async function listPushTargets(
  userId: string,
  options: { db?: Database } = {},
): Promise<{ endpoint: string; p256dh: string; auth: string }[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId));
}

/** Devices for the "where you get notified" list. Endpoints are never returned. */
export async function listSubscriptions(
  userId: string,
  options: { db?: Database } = {},
): Promise<DeviceSummary[]> {
  const db = options.db ?? getDb();
  return db
    .select({
      id: pushSubscriptions.id,
      userAgent: pushSubscriptions.userAgent,
      createdAt: pushSubscriptions.createdAt,
      lastSuccessAt: pushSubscriptions.lastSuccessAt,
    })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))
    .orderBy(desc(pushSubscriptions.createdAt));
}
