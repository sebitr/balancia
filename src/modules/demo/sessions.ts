import "server-only";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { groups, users } from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import type { UserActor } from "@/lib/security/authorization";
import { createSession, type CreatedSession } from "@/modules/auth/sessions";
import { insertUser } from "@/modules/auth/service";
import { seedDemoWorkspace } from "./dataset";

/**
 * Throwaway accounts for the public demo.
 *
 * Signing in with `demo` / `demo` does not sign anyone in to a shared account.
 * It mints a *new* account, with its own private copy of the demo workspace,
 * and signs the visitor in to that. Two people trying the demo at the same
 * time therefore never see each other's expenses — not by filtering, but
 * because `authorizeGroup` has always been the only way into a group and
 * neither is a member of the other's.
 *
 * All of it lives in the in-memory database (src/lib/db/demo-database.ts), so
 * "throwaway" is literal: the sweeper below drops accounts a couple of hours
 * old, and restarting the process drops all of them at once.
 */

/** How long a visitor's demo lasts before it is swept. */
const DEMO_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * How many demos may exist at once.
 *
 * Every one of them is rows in a database held in this process's memory, so
 * this is the ceiling on what a demo instance costs — and on what someone
 * clicking the button in a loop can make it cost. Past it, the oldest is swept
 * early rather than the newest refused: a visitor arriving at a busy moment
 * should get a demo, and the person they displace has been gone for hours.
 */
const MAX_CONCURRENT_DEMOS = 200;

/** How often the sweeper runs. */
const SWEEP_INTERVAL_MS = 10 * 60 * 1000;

interface DemoRecord {
  readonly userId: string;
  readonly groupIds: readonly string[];
  readonly createdAt: number;
}

/**
 * The demos this process has handed out, oldest first.
 *
 * A Map rather than a table: it is bookkeeping about the in-memory database,
 * not data in it, and it must not survive a restart any more than the rows do.
 * Insertion order is the age order, which is what the eviction below relies on.
 *
 * On `globalThis` for the reason the database itself is (see
 * src/lib/db/demo-database.ts): Next.js instantiates this module once for the
 * instrumentation hook and again for the application, and the sweeper starts in
 * the first while every visitor is minted in the second. A module-level Map
 * would leave the sweeper looking at an empty registry forever — nothing would
 * be cleaned up, and nothing would say so.
 */
declare global {
  var __balanciaDemoSessions: Map<string, DemoRecord> | undefined;
}

function registry(): Map<string, DemoRecord> {
  globalThis.__balanciaDemoSessions ??= new Map<string, DemoRecord>();
  return globalThis.__balanciaDemoSessions;
}

export interface StartedDemo {
  readonly user: UserActor;
  readonly session: CreatedSession;
}

/**
 * Creates a demo account, fills it, and signs it in.
 *
 * Built from `insertUser` and `createSession` rather than `registerUser`
 * because registration is not what is happening: there is no email to verify,
 * no mail to send, and `ALLOW_REGISTRATION=false` — which a demo instance
 * wants, so nobody creates a real-looking account that dies at the next deploy
 * — must not disable the demo itself.
 */
export async function startDemoSession(
  context: { userAgent?: string | null; ipAddress?: string | null } = {},
  options: { db?: Database; now?: Date } = {},
): Promise<StartedDemo> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();

  await enforceCapacity(db, now);

  /*
   * `.invalid` is reserved by RFC 2606 and can never be delivered to, which is
   * the point: a demo address must not collide with a real one, and must not
   * be mistaken for somewhere mail could be sent.
   */
  const email = `demo-${randomUUID()}@demo.invalid`;
  const userId = await insertUser(
    { email, name: "Demo", passwordHash: null },
    { db },
  );

  await db
    .update(users)
    .set({
      // Nothing to confirm — there is no inbox — and an unverified account
      // cannot sign in on an instance with mail configured.
      emailVerifiedAt: now,
      /*
       * `insertUser` makes the first account on an instance the administrator,
       * which is right for a self-hosted deployment and wrong here: on a demo
       * it would hand the telemetry settings to whichever stranger arrived
       * first after a restart.
       */
      isAdmin: false,
    })
    .where(eq(users.id, userId));

  const user: UserActor = { kind: "user", userId, email, name: "Demo" };

  const workspace = await seedDemoWorkspace(user, { db });
  const session = await createSession(userId, context, { db, now });

  registry().set(userId, {
    userId,
    groupIds: [workspace.tripGroupId, workspace.flatGroupId],
    createdAt: now.getTime(),
  });

  logger.info({ demos: registry().size }, "Started a demo session");
  return { user, session };
}

/**
 * Drops every demo past its time to live.
 *
 * Groups have to go explicitly: `groups.created_by_user_id` is ON DELETE SET
 * NULL, not CASCADE, because a real group outlives the account that made it.
 * Deleting them first takes their expenses, settlements, participants and
 * activity with them; the user row then cascades to sessions and preferences.
 */
export async function sweepDemoSessions(
  options: { db?: Database; now?: Date } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const expired = [...registry().values()].filter(
    (record) => now.getTime() - record.createdAt >= DEMO_TTL_MS,
  );
  return drop(expired, options.db ?? getDb());
}

/** Starts the periodic sweep. Called once, from `instrumentation.ts`. */
export function startDemoSweeper(): void {
  const timer = setInterval(() => {
    void sweepDemoSessions().catch((error: unknown) => {
      // Never fatal: a sweep that fails leaves rows in a database that is
      // discarded on restart anyway, and the next tick tries again.
      logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        "Demo sweep failed",
      );
    });
  }, SWEEP_INTERVAL_MS);
  // Nothing should be kept alive by this.
  timer.unref();
}

/** Test seam: how many demos this process is holding. */
export function liveDemoCount(): number {
  return registry().size;
}

async function enforceCapacity(db: Database, now: Date): Promise<void> {
  // Expired ones first — they are free, and usually enough.
  await sweepDemoSessions({ db, now });
  if (registry().size < MAX_CONCURRENT_DEMOS) return;

  const overflow = registry().size - MAX_CONCURRENT_DEMOS + 1;
  await drop([...registry().values()].slice(0, overflow), db);
}

async function drop(
  records: readonly DemoRecord[],
  db: Database,
): Promise<number> {
  if (records.length === 0) return 0;

  const groupIds = records.flatMap((record) => [...record.groupIds]);
  if (groupIds.length > 0) {
    await db.delete(groups).where(inArray(groups.id, groupIds));
  }
  await db.delete(users).where(
    inArray(
      users.id,
      records.map((record) => record.userId),
    ),
  );

  for (const record of records) {
    registry().delete(record.userId);
  }
  logger.info(
    { dropped: records.length, remaining: registry().size },
    "Swept demo sessions",
  );
  return records.length;
}
