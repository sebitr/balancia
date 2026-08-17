import "server-only";
import { and, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "@/lib/db/client";
import { getDb } from "@/lib/db/client";
import { notifications, pushSubscriptions, users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { notificationTranslator, resolveLocale } from "@/i18n/emails";
import { DEFAULT_LOCALE } from "@/i18n/locales";
import { isNumberFormat, numberLocale } from "@/i18n/format";
import {
  drawsOwnAttribution,
  isPushConfigured,
  sendPush,
  type PushOutcome,
} from "@/lib/push/send";
import { renderNotification, type Translate } from "./render";
import type { NotificationEntry, NotificationPayload } from "./types";

/**
 * Push delivery.
 *
 * Runs in the worker, never in a request. Two things enter here: the fast path
 * (`deliverNotifications`, queued the moment a change commits) and the sweep
 * (`sweepPendingNotifications`, which catches anything the fast path missed
 * because the queue or the process was having a bad moment).
 *
 * Both claim their rows the same way — an UPDATE that stamps `pushed_at` only
 * where it is still null — so the two can run at the same time without any
 * chance of sending the same notification twice.
 */

/** How many endpoints to talk to at once. Push services are not slow; be polite. */
const CONCURRENCY = 8;

/**
 * What the lock screen calls us, where the browser will not say it itself.
 *
 * A push card carries the group name and nothing else about where it came
 * from, sitting among cards from every other app on the phone — so the title
 * says it, except on the browsers that already do (see
 * `drawsOwnAttribution`). Matches the manifest's `short_name` and the service
 * worker's fallback title.
 */
const BRAND = "Balancia";

/**
 * The sweep ignores anything newer than this, so it never races the fast path
 * for a notification that was queued a second ago.
 */
const SWEEP_DELAY_MS = 2 * 60 * 1000;

/**
 * Past this age a notification is no longer worth pushing — it is still in the
 * inbox, but a card about this morning's coffee arriving tonight is noise. The
 * row is stamped so it stops being swept.
 */
const STALE_AFTER_MS = 60 * 60 * 1000;

/** A subscription that keeps failing temporarily is eventually retired. */
const MAX_CONSECUTIVE_FAILURES = 10;

export interface DeliveryReport {
  /** Notifications this run took responsibility for. */
  readonly claimed: number;
  /** Push messages accepted by a push service. */
  readonly sent: number;
  /** Subscriptions deleted because the push service said they are gone. */
  readonly expired: number;
  /** Sends that failed in a way worth retrying — not retried in this run. */
  readonly retried: number;
  readonly failed: number;
  /** Notifications with nowhere to push: the reader has no subscribed device. */
  readonly withoutDevices: number;
}

const EMPTY_REPORT: DeliveryReport = {
  claimed: 0,
  sent: 0,
  expired: 0,
  retried: 0,
  failed: 0,
  withoutDevices: 0,
};

interface ClaimedRow extends NotificationEntry {
  readonly userId: string;
}

/** Maps a claimed database row onto the shape the renderer wants. */
function toEntry(row: {
  id: string;
  userId: string;
  groupId: string;
  type: NotificationEntry["type"];
  category: NotificationEntry["category"];
  entityType: string;
  entityId: string | null;
  actorLabel: string | null;
  payload: unknown;
  createdAt: Date;
}): ClaimedRow {
  return {
    ...row,
    payload: row.payload as NotificationPayload,
    readAt: null,
  };
}

const CLAIM_COLUMNS = {
  id: notifications.id,
  userId: notifications.userId,
  groupId: notifications.groupId,
  type: notifications.type,
  category: notifications.category,
  entityType: notifications.entityType,
  entityId: notifications.entityId,
  actorLabel: notifications.actorLabel,
  payload: notifications.payload,
  createdAt: notifications.createdAt,
};

/**
 * Turns a render tag into a `Topic` header a push service will accept.
 *
 * RFC 8030 limits a topic to 32 characters of base64url, while our tags look
 * like "expense:3f2b…-…". Stripping the punctuation and truncating keeps the
 * collapsing behaviour — later news about one expense replaces earlier
 * undelivered news about it — without sending a header that would be rejected.
 */
function pushTopic(tag: string): string {
  return tag.replace(/[^A-Za-z0-9_-]/g, "").slice(-32);
}

/** Runs tasks with a ceiling on how many are in flight at once. */
async function withConcurrency<T>(
  tasks: readonly (() => Promise<T>)[],
  limit: number,
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, tasks.length) },
    async () => {
      while (next < tasks.length) {
        const index = next++;
        results[index] = await tasks[index]();
      }
    },
  );
  await Promise.all(workers);
  return results;
}

/**
 * Pushes a batch of already-claimed notifications.
 *
 * Everything here is best-effort by design: the notification is already in the
 * reader's inbox, so a push that cannot be delivered costs a log line, not
 * data.
 */
async function pushClaimed(
  db: Database,
  claimed: readonly ClaimedRow[],
): Promise<DeliveryReport> {
  if (claimed.length === 0) return { ...EMPTY_REPORT };

  const userIds = [...new Set(claimed.map((row) => row.userId))];

  const readers = await db
    .select({
      id: users.id,
      locale: users.locale,
      numberFormat: users.numberFormat,
    })
    .from(users)
    .where(inArray(users.id, userIds));
  const localeByUser = new Map(
    readers.map((reader) => [reader.id, resolveLocale(reader.locale)]),
  );
  // A reader who writes amounts a particular way is owed that on their lock
  // screen too, not only inside the app.
  const numberLocaleByUser = new Map(
    readers.map((reader) => {
      const locale = resolveLocale(reader.locale);
      return [
        reader.id,
        numberLocale(
          isNumberFormat(reader.numberFormat) ? reader.numberFormat : "auto",
          locale,
        ),
      ];
    }),
  );

  const devices = await db
    .select({
      id: pushSubscriptions.id,
      userId: pushSubscriptions.userId,
      endpoint: pushSubscriptions.endpoint,
      p256dh: pushSubscriptions.p256dh,
      auth: pushSubscriptions.auth,
    })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, userIds));

  const devicesByUser = new Map<string, typeof devices>();
  for (const device of devices) {
    const bucket = devicesByUser.get(device.userId);
    if (bucket) bucket.push(device);
    else devicesByUser.set(device.userId, [device]);
  }

  interface SendResult {
    readonly subscriptionId: string;
    readonly outcome: PushOutcome;
  }

  /** One notification, rendered and ready for a particular kind of browser. */
  interface Message {
    readonly payload: string;
    readonly topic: string;
  }

  const tasks: (() => Promise<SendResult>)[] = [];
  let withoutDevices = 0;

  for (const row of claimed) {
    const userDevices = devicesByUser.get(row.userId);
    if (!userDevices?.length) {
      withoutDevices += 1;
      continue;
    }

    const locale = localeByUser.get(row.userId) ?? DEFAULT_LOCALE;
    const translate = notificationTranslator(locale) as Translate;

    const build = (brand: string | undefined): Message => {
      const rendered = renderNotification(row, translate, locale, {
        numberLocale: numberLocaleByUser.get(row.userId),
        brand,
      });
      return {
        payload: JSON.stringify({
          title: rendered.title,
          body: rendered.body,
          url: rendered.url,
          tag: rendered.tag,
          notificationId: row.id,
        }),
        topic: pushTopic(rendered.tag),
      };
    };

    /*
     * The same notification, titled twice.
     *
     * Safari already writes "from Balancia" beneath whatever title it is
     * given, so a title that says it too says it twice; every other browser
     * writes nothing, so a title that leaves it out leaves the card
     * unattributed. One reader can hold both kinds of device at once, which is
     * why this is decided per endpoint and not per person.
     *
     * Built on demand and kept: most readers have devices of one kind, and
     * rendering the variant nobody is subscribed to would be work for nothing.
     */
    let plain: Message | undefined;
    let branded: Message | undefined;

    for (const device of userDevices) {
      const message = drawsOwnAttribution(device.endpoint)
        ? (plain ??= build(undefined))
        : (branded ??= build(BRAND));
      tasks.push(async () => ({
        subscriptionId: device.id,
        outcome: await sendPush(device, message.payload, {
          topic: message.topic,
        }),
      }));
    }
  }

  const results = await withConcurrency(tasks, CONCURRENCY);

  const expired = new Set<string>();
  const succeeded = new Set<string>();
  const failing = new Set<string>();
  let sent = 0;
  let retried = 0;
  let failed = 0;

  for (const result of results) {
    switch (result.outcome.status) {
      case "sent":
        sent += 1;
        succeeded.add(result.subscriptionId);
        break;
      case "expired":
        expired.add(result.subscriptionId);
        break;
      case "retry":
        retried += 1;
        failing.add(result.subscriptionId);
        break;
      case "failed":
        failed += 1;
        failing.add(result.subscriptionId);
        logger.warn(
          { reason: result.outcome.reason },
          "Push message rejected by the push service",
        );
        break;
    }
  }

  // A subscription the service says is gone will never work again: drop it,
  // rather than retrying it forever for someone who uninstalled the app.
  if (expired.size > 0) {
    await db
      .delete(pushSubscriptions)
      .where(inArray(pushSubscriptions.id, [...expired]));
  }
  if (succeeded.size > 0) {
    await db
      .update(pushSubscriptions)
      .set({ lastSuccessAt: new Date(), failureCount: 0 })
      .where(inArray(pushSubscriptions.id, [...succeeded]));
  }
  const stillFailing = [...failing].filter((id) => !succeeded.has(id));
  if (stillFailing.length > 0) {
    await db
      .update(pushSubscriptions)
      .set({ failureCount: sql`${pushSubscriptions.failureCount} + 1` })
      .where(inArray(pushSubscriptions.id, stillFailing));
    await db
      .delete(pushSubscriptions)
      .where(
        and(
          inArray(pushSubscriptions.id, stillFailing),
          gte(pushSubscriptions.failureCount, MAX_CONSECUTIVE_FAILURES),
        ),
      );
  }

  return {
    claimed: claimed.length,
    sent,
    expired: expired.size,
    retried,
    failed,
    withoutDevices,
  };
}

/**
 * The fast path: push the notifications a just-committed change created.
 *
 * Claiming with `pushed_at IS NULL` is what makes this safe to call twice —
 * pg-boss may retry a job whose handler already ran.
 */
export async function deliverNotifications(
  notificationIds: readonly string[],
  options: { db?: Database } = {},
): Promise<DeliveryReport> {
  if (notificationIds.length === 0) return { ...EMPTY_REPORT };
  if (!isPushConfigured()) return { ...EMPTY_REPORT };

  const db = options.db ?? getDb();
  const claimed = await db
    .update(notifications)
    .set({ pushedAt: new Date() })
    .where(
      and(
        inArray(notifications.id, [...notificationIds]),
        isNull(notifications.pushedAt),
      ),
    )
    .returning(CLAIM_COLUMNS);

  return pushClaimed(db, claimed.map(toEntry));
}

/**
 * The safety net: anything that never got pushed, because the queue was
 * unreachable or the process died between committing and enqueuing.
 */
export async function sweepPendingNotifications(
  options: { db?: Database; now?: Date } = {},
): Promise<DeliveryReport> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  // Too old to be worth announcing. Stamped so the pending index stays small
  // and this row is never looked at again.
  const stale = await db
    .update(notifications)
    .set({ pushedAt: now })
    .where(
      and(
        isNull(notifications.pushedAt),
        lte(notifications.createdAt, new Date(now.getTime() - STALE_AFTER_MS)),
      ),
    )
    .returning({ id: notifications.id });
  if (stale.length > 0) {
    logger.info(
      { count: stale.length },
      "Skipped push for notifications that were too old to be useful",
    );
  }

  if (!isPushConfigured()) return { ...EMPTY_REPORT };

  const claimed = await db
    .update(notifications)
    .set({ pushedAt: now })
    .where(
      and(
        isNull(notifications.pushedAt),
        lte(notifications.createdAt, new Date(now.getTime() - SWEEP_DELAY_MS)),
      ),
    )
    .returning(CLAIM_COLUMNS);

  const report = await pushClaimed(db, claimed.map(toEntry));
  if (report.claimed > 0) {
    logger.info(report, "Delivered notifications the fast path had missed");
  }
  return report;
}

/**
 * Housekeeping: read notifications older than the retention window are
 * deleted. The activity log is the permanent record; this is a mailbox.
 */
export async function pruneNotifications(
  olderThan: Date,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const rows = await db
    .delete(notifications)
    .where(lte(notifications.createdAt, olderThan))
    .returning({ id: notifications.id });
  return rows.length;
}

/**
 * Timings the worker's schedule and the tests both refer to, so neither can
 * drift from the behaviour above.
 */
export const DELIVERY_TIMING = {
  SWEEP_DELAY_MS,
  STALE_AFTER_MS,
  MAX_CONSECUTIVE_FAILURES,
} as const;
