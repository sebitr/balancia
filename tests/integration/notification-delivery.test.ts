import { createECDH, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { getDb } from "@/lib/db/client";
import {
  groupMembers,
  notifications,
  participants,
  pushSubscriptions,
} from "@/lib/db/schema";
import { resetEnvCache } from "@/lib/env";
import { generateKeyPair, toBase64Url } from "@/lib/push/keys";
import { resetPushKeys } from "@/lib/push/send";
import { resetTokenCache } from "@/lib/push/vapid";
import {
  deliverNotifications,
  sweepPendingNotifications,
} from "@/modules/notifications/delivery";
import { createExpense } from "@/modules/expenses/service";
import type { UserActor } from "@/lib/security/authorization";
import {
  createTestGroup,
  createTestUser,
  isoToday,
} from "../helpers/factories";

/**
 * Push delivery against a stubbed push service.
 *
 * The properties worth pinning are the ones a retry or a crash would break:
 * a notification is pushed at most once however many times delivery runs, a
 * subscription the push service has retired is deleted rather than retried
 * forever, and the sweep only picks up what the fast path actually missed.
 */

const realFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

/** A subscription with real key material, so the encryption step runs for real. */
function subscriptionKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: toBase64Url(ecdh.getPublicKey()),
    auth: toBase64Url(randomBytes(16)),
  };
}

function pushResponse(status: number): Response {
  return new Response(status === 201 ? null : "no", { status });
}

async function addTestMember(groupId: string, name: string) {
  const db = getDb();
  const actor: UserActor = await createTestUser({ name });
  const [participant] = await db
    .insert(participants)
    .values({ groupId, displayName: name, userId: actor.userId })
    .returning({ id: participants.id });
  await db.insert(groupMembers).values({
    groupId,
    userId: actor.userId,
    participantId: participant.id,
    role: "member",
  });
  return { actor, participantId: participant.id };
}

async function setup() {
  const owner = await createTestUser({ name: "Ada" });
  const group = await createTestGroup(owner, { name: "Trip" });
  const member = await addTestMember(group.groupId, "Blaise");

  const expenseId = await createExpense(group.access, {
    description: "Dinner",
    notes: "",
    category: "",
    amount: "4800",
    currency: "EUR",
    exchangeRate: "",
    payers: [{ participantId: group.ownerParticipantId, amount: "4800" }],
    splitMethod: "equal",
    splitEntries: [
      { participantId: group.ownerParticipantId },
      { participantId: member.participantId },
    ],
    expenseDate: isoToday(),
  });

  const db = getDb();
  const [notification] = await db
    .select({ id: notifications.id })
    .from(notifications)
    .where(eq(notifications.userId, member.actor.userId));

  return { owner, group, member, expenseId, notificationId: notification.id };
}

/** Registers a device for a user and returns its endpoint. */
async function subscribe(userId: string, endpoint: string) {
  await getDb()
    .insert(pushSubscriptions)
    .values({ userId, endpoint, ...subscriptionKeys() });
  return endpoint;
}

beforeEach(() => {
  const keys = generateKeyPair();
  process.env.PUSH_VAPID_PUBLIC_KEY = keys.publicKey;
  process.env.PUSH_VAPID_PRIVATE_KEY = keys.privateKey;
  process.env.PUSH_VAPID_SUBJECT = "mailto:admin@example.test";
  resetEnvCache();
  resetPushKeys();
  resetTokenCache();

  fetchMock = vi.fn(async () => pushResponse(201));
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.PUSH_VAPID_PUBLIC_KEY;
  delete process.env.PUSH_VAPID_PRIVATE_KEY;
  delete process.env.PUSH_VAPID_SUBJECT;
  resetEnvCache();
  resetPushKeys();
  resetTokenCache();
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("push delivery", () => {
  it("posts an encrypted message with a VAPID token", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/abc");

    const report = await deliverNotifications([notificationId]);

    expect(report).toMatchObject({ claimed: 1, sent: 1, expired: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://push.example.test/abc");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Encoding"]).toBe("aes128gcm");
    expect(headers.Authorization).toMatch(
      /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=/,
    );
    // The body is ciphertext, not the JSON that went in.
    const body = Buffer.from(init.body as Uint8Array);
    expect(body.length).toBeGreaterThan(86);
    expect(body.toString("utf8")).not.toContain("Dinner");
  });

  /**
   * Safari writes "from Balancia" under any title it is given and the others
   * write nothing, so the same notification has to leave with two different
   * titles — and one person can be holding both kinds of device.
   *
   * The bodies are ciphertext, so the titles are compared by the one thing
   * that survives encryption: length. Nothing here pads, so the gap between
   * the two payloads is exactly the suffix the Chrome device's title carries
   * and the Safari one does not.
   */
  it("names the app to Chrome and leaves Safari to name it itself", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://web.push.apple.com/safari");
    await subscribe(
      member.actor.userId,
      "https://fcm.googleapis.com/fcm/send/c",
    );

    const report = await deliverNotifications([notificationId]);

    expect(report).toMatchObject({ claimed: 1, sent: 2 });

    const byEndpoint = new Map(
      fetchMock.mock.calls.map(([url, init]) => [
        url as string,
        Buffer.from((init as RequestInit).body as Uint8Array).length,
      ]),
    );
    expect([...byEndpoint.keys()].sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/c",
      "https://web.push.apple.com/safari",
    ]);

    const safari = byEndpoint.get("https://web.push.apple.com/safari")!;
    const chrome = byEndpoint.get("https://fcm.googleapis.com/fcm/send/c")!;
    expect(chrome - safari).toBe(" - Balancia".length);
  });

  it("pushes a notification at most once, however often delivery runs", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/abc");

    const first = await deliverNotifications([notificationId]);
    const second = await deliverNotifications([notificationId]);

    expect(first.claimed).toBe(1);
    // pg-boss may retry a job whose handler already finished; the claim is
    // what makes that harmless.
    expect(second.claimed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("deletes a subscription the push service says is gone", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/gone");
    fetchMock.mockResolvedValue(pushResponse(410));

    const report = await deliverNotifications([notificationId]);

    expect(report).toMatchObject({ sent: 0, expired: 1 });
    const remaining = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, member.actor.userId));
    expect(remaining).toHaveLength(0);
  });

  it("keeps a subscription that failed for a temporary reason", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/busy");
    fetchMock.mockResolvedValue(pushResponse(503));

    const report = await deliverNotifications([notificationId]);

    expect(report).toMatchObject({ sent: 0, retried: 1, expired: 0 });
    const [row] = await getDb()
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.userId, member.actor.userId));
    expect(row).toBeDefined();
    expect(row.failureCount).toBe(1);
  });

  it("marks a notification handled even when there is no device to push to", async () => {
    const { member, notificationId } = await setup();

    const report = await deliverNotifications([notificationId]);

    expect(report).toMatchObject({ claimed: 1, sent: 0, withoutDevices: 1 });
    expect(fetchMock).not.toHaveBeenCalled();

    // Still unread in the inbox: not pushing it is not the same as reading it.
    const [row] = await getDb()
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, member.actor.userId),
        ),
      );
    expect(row.pushedAt).not.toBeNull();
    expect(row.readAt).toBeNull();
  });
});

describe("the delivery sweep", () => {
  it("picks up a notification the fast path never enqueued", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/abc");

    // Older than the sweep's delay, so it is fair game.
    const createdAt = new Date(Date.now() - 5 * 60 * 1000);
    await getDb()
      .update(notifications)
      .set({ createdAt })
      .where(eq(notifications.id, notificationId));

    const report = await sweepPendingNotifications();

    expect(report).toMatchObject({ claimed: 1, sent: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("leaves a notification the fast path is still working on", async () => {
    const { member } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/abc");

    // Just written: the queued job has not had its chance yet.
    const report = await sweepPendingNotifications();

    expect(report.claimed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives up on one too old to be worth announcing", async () => {
    const { member, notificationId } = await setup();
    await subscribe(member.actor.userId, "https://push.example.test/abc");

    await getDb()
      .update(notifications)
      .set({ createdAt: new Date(Date.now() - 3 * 60 * 60 * 1000) })
      .where(eq(notifications.id, notificationId));

    const report = await sweepPendingNotifications();

    expect(report.claimed).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    // Stamped, so it stops being swept — but still readable in the inbox.
    const [row] = await getDb()
      .select()
      .from(notifications)
      .where(eq(notifications.id, notificationId));
    expect(row.pushedAt).not.toBeNull();
    expect(row.readAt).toBeNull();
  });
});
