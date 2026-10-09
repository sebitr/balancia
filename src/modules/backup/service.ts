import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { getDb, type Database } from "@/lib/db/client";
import { backupDestinations, backupKeys, backupRuns } from "@/lib/db/schema";
import { publish, QUEUES, type BackupRunPayload } from "@/lib/jobs/queue";
import { logger } from "@/lib/logger";
import { open, seal } from "@/lib/security/secret-box";
import { encryptTo, keyFingerprint, parseRecipient } from "./age";
import { buildBundle, serialiseBundle } from "./bundle";
import { BackupError, scrub, type BackupErrorCode } from "./errors";
import { bundleName, parseBundleName, selectExpired } from "./naming";
import {
  credentialSchemas,
  PROVIDER_NAMES,
  type BackupProvider,
  type OwnOAuthApp,
} from "./providers";
import {
  nextRunAfter,
  retryDelayMs,
  shouldSkipUnchanged,
  type Frequency,
} from "./schedule";
import { listReceipts, syncReceipts, type ReceiptSync } from "./receipts";
import { getStorage, type StorageDriver } from "@/lib/storage";
import {
  openTransport,
  type BackupTransport,
  type OpenOptions,
} from "./transport";

/**
 * Cloud backup: keys, destinations, and the run that writes to one.
 *
 * The rules this file keeps, in the order they matter:
 *
 *  1. **A person only ever reaches their own rows.** Every function that takes
 *     a user takes it as part of the lookup, never as a check after it, so a
 *     destination id from someone else's account finds nothing.
 *  2. **Credentials are sealed at rest and never leave.** What the screens get
 *     is a `DestinationView`, which has no field a secret could be in.
 *  3. **A run records what happened, in every case.** It writes one
 *     `backup_runs` row and moves the destination's schedule whether it
 *     worked, found nothing to do, or failed — a backup that stops quietly is
 *     the failure this exists to prevent.
 *  4. **A run never throws at the queue.** A failure is data, with a code and
 *     a retry time. Handing it back to the queue would only retry it at once,
 *     which is the wrong cadence for a revoked token.
 */

/** The seal's purpose string; a ciphertext for one purpose opens for no other. */
const SEAL_PURPOSE = "backup-destination";

/** A run that has been "running" this long is taken to be dead. */
const STALE_RUN_MS = 2 * 60 * 60 * 1000;

/** How long a connection may wait in `setup` for the person to finish the wizard. */
const SETUP_GRACE_MS = 24 * 60 * 60 * 1000;

/** How soon a run that stopped at its receipt budget is picked up again. */
const RECEIPT_CONTINUE_MS = 60 * 60 * 1000;

export const MAX_DESTINATIONS_PER_USER = 5;

export type BackupInputCode =
  "invalidKey" | "noKey" | "tooMany" | "notFound" | "invalidDetails";

/** A refusal caused by what was asked, as opposed to a fault in the cloud. */
export class BackupInputError extends Error {
  readonly code: BackupInputCode;

  constructor(code: BackupInputCode, message = code) {
    super(message);
    this.name = "BackupInputError";
    this.code = code;
  }
}

// ── The recovery key's public half ───────────────────────────────────────────

export interface BackupKeyView {
  readonly fingerprint: string;
  readonly createdAt: Date;
}

export async function getBackupKey(
  userId: string,
  options: { db?: Database } = {},
): Promise<(BackupKeyView & { readonly recipient: string }) | null> {
  const db = options.db ?? getDb();
  const [row] = await db
    .select()
    .from(backupKeys)
    .where(eq(backupKeys.userId, userId))
    .limit(1);
  return row ?? null;
}

/**
 * Stores the public half of a recovery key.
 *
 * Only a *recipient* is accepted: `parseRecipient` refuses the private half
 * outright, so a client that sent the wrong string by mistake cannot make this
 * server hold the one thing it must never hold.
 *
 * Replacing a key changes what later backups are encrypted to. Files already
 * written stay readable by the old key only, which is why the screen asks
 * people to keep it.
 */
export async function saveBackupKey(
  userId: string,
  recipient: string,
  options: { db?: Database } = {},
): Promise<BackupKeyView> {
  const parsed = await parseRecipient(recipient);
  if (!parsed) throw new BackupInputError("invalidKey");
  const db = options.db ?? getDb();
  const fingerprint = await keyFingerprint(parsed);

  const [row] = await db
    .insert(backupKeys)
    .values({ userId, recipient: parsed, fingerprint })
    .onConflictDoUpdate({
      target: backupKeys.userId,
      set: { recipient: parsed, fingerprint, createdAt: new Date() },
    })
    .returning({
      fingerprint: backupKeys.fingerprint,
      createdAt: backupKeys.createdAt,
    });
  if (!row) throw new Error("The key was not saved.");
  return row;
}

// ── Sealed credentials ───────────────────────────────────────────────────────

function sealCredentials(id: string, credentials: unknown): string {
  // The id is sealed with them, so a row copied onto another destination does
  // not open there.
  return seal(SEAL_PURPOSE, JSON.stringify({ id, credentials }));
}

function openCredentials(id: string, sealed: string): unknown {
  const plain = open(SEAL_PURPOSE, sealed);
  if (plain === null) {
    throw new BackupError(
      "reconnect",
      "The saved details can no longer be read. This usually follows a change of AUTH_SECRET.",
    );
  }
  try {
    const parsed = JSON.parse(plain) as { id?: unknown; credentials?: unknown };
    if (parsed.id !== id) throw new Error("mismatch");
    return parsed.credentials;
  } catch {
    throw new BackupError("reconnect", "The saved details are damaged.");
  }
}

// ── Destinations ─────────────────────────────────────────────────────────────

export interface RunView {
  readonly id: string;
  readonly trigger: "schedule" | "manual";
  readonly status: "running" | "succeeded" | "unchanged" | "failed";
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly groupCount: number;
  readonly bytes: number;
  readonly objectName: string | null;
  readonly receiptsWritten: number;
  readonly receiptsPending: number;
  readonly errorCode: BackupErrorCode | null;
  readonly errorDetail: string | null;
}

export interface DestinationView {
  readonly id: string;
  readonly provider: BackupProvider;
  readonly label: string;
  readonly frequency: Frequency;
  readonly keepLast: number;
  readonly excludedGroupIds: readonly string[];
  readonly includeReceipts: boolean;
  readonly status: "setup" | "active" | "paused" | "needs_reconnect";
  readonly nextRunAt: Date;
  readonly lastRunAt: Date | null;
  readonly lastSuccessAt: Date | null;
  readonly consecutiveFailures: number;
  readonly createdAt: Date;
  /** What a screen should raise above everything else, if anything. */
  readonly attention: "reconnect" | "failing" | null;
  readonly latestRun: RunView | null;
  readonly latestSuccess: RunView | null;
}

const RUN_COLUMNS = {
  id: backupRuns.id,
  destinationId: backupRuns.destinationId,
  trigger: backupRuns.trigger,
  status: backupRuns.status,
  startedAt: backupRuns.startedAt,
  finishedAt: backupRuns.finishedAt,
  groupCount: backupRuns.groupCount,
  bytes: backupRuns.bytes,
  objectName: backupRuns.objectName,
  receiptsWritten: backupRuns.receiptsWritten,
  receiptsPending: backupRuns.receiptsPending,
  errorCode: backupRuns.errorCode,
  errorDetail: backupRuns.errorDetail,
} as const;

function toRunView(row: {
  id: string;
  trigger: "schedule" | "manual";
  status: RunView["status"];
  startedAt: Date;
  finishedAt: Date | null;
  groupCount: number;
  bytes: number;
  objectName: string | null;
  receiptsWritten: number;
  receiptsPending: number;
  errorCode: string | null;
  errorDetail: string | null;
}): RunView {
  return {
    id: row.id,
    trigger: row.trigger,
    status: row.status,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    groupCount: row.groupCount,
    bytes: row.bytes,
    objectName: row.objectName,
    receiptsWritten: row.receiptsWritten,
    receiptsPending: row.receiptsPending,
    errorCode: row.errorCode as BackupErrorCode | null,
    errorDetail: row.errorDetail,
  };
}

/** After this many failures in a row, a screen stops calling it a hiccup. */
const FAILING_AFTER = 3;

export async function listDestinations(
  userId: string,
  options: { db?: Database } = {},
): Promise<DestinationView[]> {
  const db = options.db ?? getDb();
  const rows = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.userId, userId))
    .orderBy(asc(backupDestinations.createdAt));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const latest = await db
    .selectDistinctOn([backupRuns.destinationId], RUN_COLUMNS)
    .from(backupRuns)
    .where(inArray(backupRuns.destinationId, ids))
    .orderBy(backupRuns.destinationId, desc(backupRuns.startedAt));
  const latestSuccess = await db
    .selectDistinctOn([backupRuns.destinationId], RUN_COLUMNS)
    .from(backupRuns)
    .where(
      and(
        inArray(backupRuns.destinationId, ids),
        inArray(backupRuns.status, ["succeeded", "unchanged"]),
      ),
    )
    .orderBy(backupRuns.destinationId, desc(backupRuns.startedAt));

  const byDestination = <T extends { destinationId: string }>(list: T[]) =>
    new Map(list.map((entry) => [entry.destinationId, entry]));
  const latestBy = byDestination(latest);
  const successBy = byDestination(latestSuccess);

  return rows.map((row) => {
    const run = latestBy.get(row.id);
    const success = successBy.get(row.id);
    return {
      id: row.id,
      provider: row.provider,
      label: row.label,
      frequency: row.frequency,
      keepLast: row.keepLast,
      excludedGroupIds: row.excludedGroupIds,
      includeReceipts: row.includeReceipts,
      status: row.status,
      nextRunAt: row.nextRunAt,
      lastRunAt: row.lastRunAt,
      lastSuccessAt: row.lastSuccessAt,
      consecutiveFailures: row.consecutiveFailures,
      createdAt: row.createdAt,
      attention:
        row.status === "needs_reconnect"
          ? "reconnect"
          : row.consecutiveFailures >= FAILING_AFTER
            ? "failing"
            : null,
      latestRun: run ? toRunView(run) : null,
      latestSuccess: success ? toRunView(success) : null,
    };
  });
}

async function loadOwn(
  userId: string,
  id: string,
  db: Database,
): Promise<typeof backupDestinations.$inferSelect> {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(
      and(eq(backupDestinations.id, id), eq(backupDestinations.userId, userId)),
    )
    .limit(1);
  // The same answer for "not yours" and "not there".
  if (!row) throw new BackupInputError("notFound");
  return row;
}

/**
 * The app a destination was connected through, when it is the person's own.
 *
 * For a reconnect, which must go back through the same app the refresh token
 * was issued to. Read here, from the sealed row, and not asked of the browser:
 * the secret was never sent back to it. None for a destination that uses the
 * operator's app.
 */
export async function getDestinationApp(
  userId: string,
  id: string,
  seams: Seams = {},
): Promise<OwnOAuthApp | undefined> {
  const db = seams.db ?? getDb();
  const row = await loadOwn(userId, id, db);
  const parsed = credentialSchemas[row.provider].safeParse(
    openCredentials(row.id, row.credentials),
  );
  if (!parsed.success) return undefined;
  return (parsed.data as { app?: OwnOAuthApp }).app;
}

export interface NewDestination {
  readonly provider: BackupProvider;
  /** Validated here against the provider's schema. */
  readonly credentials: unknown;
  readonly label?: string;
  readonly frequency?: Frequency;
  readonly keepLast?: number;
  readonly excludedGroupIds?: readonly string[];
  readonly includeReceipts?: boolean;
  /**
   * Keep it as a connection waiting for step 4 of the wizard, which `finishSetup`
   * turns into a destination. Used by the OAuth return, where the person left
   * the page and the choices they had made went with it.
   */
  readonly draft?: boolean;
}

export interface Seams {
  readonly db?: Database;
  /** Replaceable so a test can use a transport that needs no network. */
  readonly openTransport?: (
    provider: BackupProvider,
    credentials: unknown,
    options?: OpenOptions,
  ) => Promise<BackupTransport>;
  readonly now?: () => Date;
  /** Where receipts are read from; the configured storage driver unless a test says otherwise. */
  readonly storage?: StorageDriver;
  /** Most receipt bytes one run may send. The default is `RECEIPT_BYTE_BUDGET`. */
  readonly receiptByteBudget?: number;
}

function defaultLabel(provider: BackupProvider, credentials: unknown): string {
  const name = PROVIDER_NAMES[provider];
  const detail = (() => {
    const c = credentials as Record<string, unknown>;
    if (typeof c.account === "string" && c.account) return c.account;
    if (provider === "s3" && typeof c.bucket === "string") return c.bucket;
    if (provider === "webdav" && typeof c.url === "string") {
      return new URL(c.url).host;
    }
    if (typeof c.username === "string") return c.username;
    if (typeof c.appleId === "string") return c.appleId;
    return "";
  })();
  return detail ? `${name} · ${detail}` : name;
}

/**
 * Proves a set of details works the way a backup will use it, without saving
 * anything. Throws `BackupError` with a code the screen can word.
 */
export async function testDestination(
  provider: BackupProvider,
  credentials: unknown,
  seams: Seams = {},
): Promise<void> {
  const parsed = credentialSchemas[provider].safeParse(credentials);
  if (!parsed.success) throw new BackupInputError("invalidDetails");
  const transport = await (seams.openTransport ?? openTransport)(
    provider,
    parsed.data,
  );
  await transport.check();
}

export async function createDestination(
  userId: string,
  input: NewDestination,
  seams: Seams = {},
): Promise<{ readonly id: string }> {
  const db = seams.db ?? getDb();
  const now = (seams.now ?? (() => new Date()))();

  if (!(await getBackupKey(userId, { db })))
    throw new BackupInputError("noKey");

  // A connection left waiting from an earlier attempt is replaced by this one:
  // there is one wizard, and a person who starts it again is not resuming.
  await db
    .delete(backupDestinations)
    .where(
      and(
        eq(backupDestinations.userId, userId),
        eq(backupDestinations.status, "setup"),
      ),
    );

  const existing = await db
    .select({ id: backupDestinations.id })
    .from(backupDestinations)
    .where(eq(backupDestinations.userId, userId));
  if (existing.length >= MAX_DESTINATIONS_PER_USER) {
    throw new BackupInputError("tooMany");
  }

  const parsed = credentialSchemas[input.provider].safeParse(input.credentials);
  if (!parsed.success) throw new BackupInputError("invalidDetails");

  // Not saved until it has been shown to work. A destination that can never be
  // written to would otherwise sit there looking fine until the first night.
  const transport = await (seams.openTransport ?? openTransport)(
    input.provider,
    parsed.data,
  );
  await transport.check();

  const id = randomUUID();
  await db.insert(backupDestinations).values({
    id,
    userId,
    provider: input.provider,
    label: (input.label ?? defaultLabel(input.provider, parsed.data)).slice(
      0,
      120,
    ),
    credentials: sealCredentials(id, parsed.data),
    frequency: input.frequency ?? "daily",
    keepLast: input.keepLast ?? 10,
    excludedGroupIds: [...(input.excludedGroupIds ?? [])],
    includeReceipts: input.includeReceipts ?? false,
    status: input.draft ? "setup" : "active",
    // The first backup is the proof it works, so it is not made to wait a day.
    nextRunAt: now,
    createdAt: now,
    updatedAt: now,
  });
  return { id };
}

export interface SetupChoices {
  readonly frequency: Frequency;
  readonly keepLast: number;
  readonly excludedGroupIds: readonly string[];
  readonly includeReceipts: boolean;
}

/**
 * Step 4: turns a connection waiting in `setup` into a destination that runs.
 *
 * Refuses anything that is not waiting, so a stale tab cannot reset the choices
 * of a destination that has been running for a month. The first backup is
 * queued by the caller, which knows whether a queue is there.
 */
export async function finishSetup(
  userId: string,
  id: string,
  choices: SetupChoices,
  seams: Seams = {},
): Promise<void> {
  const db = seams.db ?? getDb();
  const now = (seams.now ?? (() => new Date()))();
  const row = await loadOwn(userId, id, db);
  if (row.status !== "setup") throw new BackupInputError("notFound");

  await db
    .update(backupDestinations)
    .set({
      frequency: choices.frequency,
      keepLast: choices.keepLast,
      excludedGroupIds: [...choices.excludedGroupIds],
      includeReceipts: choices.includeReceipts,
      status: "active",
      nextRunAt: now,
      updatedAt: now,
    })
    .where(
      and(eq(backupDestinations.id, id), eq(backupDestinations.userId, userId)),
    );
}

export interface DestinationPatch {
  readonly frequency?: Frequency;
  readonly keepLast?: number;
  readonly excludedGroupIds?: readonly string[];
  readonly includeReceipts?: boolean;
  readonly paused?: boolean;
  readonly label?: string;
}

export async function updateDestination(
  userId: string,
  id: string,
  patch: DestinationPatch,
  seams: Seams = {},
): Promise<void> {
  const db = seams.db ?? getDb();
  const now = (seams.now ?? (() => new Date()))();
  const row = await loadOwn(userId, id, db);

  const set: Partial<typeof backupDestinations.$inferInsert> = {
    updatedAt: now,
  };
  if (patch.keepLast !== undefined) set.keepLast = patch.keepLast;
  if (patch.excludedGroupIds !== undefined) {
    set.excludedGroupIds = [...patch.excludedGroupIds];
  }
  if (patch.includeReceipts !== undefined) {
    set.includeReceipts = patch.includeReceipts;
    // Switching receipts on starts them tonight, or sooner: waiting a day to
    // learn the first of thousands has begun to upload is a poor answer to a
    // switch that has just been flipped.
    if (
      patch.includeReceipts &&
      !row.includeReceipts &&
      row.status === "active"
    ) {
      set.nextRunAt = now;
    }
  }
  if (patch.label !== undefined) set.label = patch.label.slice(0, 120);

  if (patch.frequency !== undefined && patch.frequency !== row.frequency) {
    set.frequency = patch.frequency;
    // Counted from the last good backup, so choosing "weekly" does not wait a
    // whole new week and choosing "daily" does not wait out the old one.
    const base = row.lastSuccessAt ?? now;
    set.nextRunAt = new Date(
      Math.max(now.getTime(), nextRunAfter(base, patch.frequency).getTime()),
    );
  }

  if (patch.paused !== undefined) {
    if (patch.paused) {
      if (row.status === "active") set.status = "paused";
    } else if (row.status === "paused") {
      set.status = "active";
      set.nextRunAt = now;
    }
  }

  await db
    .update(backupDestinations)
    .set(set)
    .where(
      and(eq(backupDestinations.id, id), eq(backupDestinations.userId, userId)),
    );
}

/** After the person reconnects: new credentials, and the schedule resumes. */
export async function replaceCredentials(
  userId: string,
  id: string,
  credentials: unknown,
  seams: Seams = {},
): Promise<void> {
  const db = seams.db ?? getDb();
  const now = (seams.now ?? (() => new Date()))();
  const row = await loadOwn(userId, id, db);

  const parsed = credentialSchemas[row.provider].safeParse(credentials);
  if (!parsed.success) throw new BackupInputError("invalidDetails");
  const transport = await (seams.openTransport ?? openTransport)(
    row.provider,
    parsed.data,
  );
  await transport.check();

  await db
    .update(backupDestinations)
    .set({
      credentials: sealCredentials(id, parsed.data),
      status: "active",
      consecutiveFailures: 0,
      nextRunAt: now,
      updatedAt: now,
    })
    .where(eq(backupDestinations.id, id));
}

/**
 * Forgets a destination. Files already written to it are the person's and stay
 * where they are: Balancia deletes only what its own retention rule names, and
 * only while the destination exists.
 */
export async function deleteDestination(
  userId: string,
  id: string,
  seams: Seams = {},
): Promise<void> {
  const db = seams.db ?? getDb();
  await loadOwn(userId, id, db);
  await db
    .delete(backupDestinations)
    .where(
      and(eq(backupDestinations.id, id), eq(backupDestinations.userId, userId)),
    );
}

export async function listRuns(
  userId: string,
  destinationId: string,
  options: { db?: Database; limit?: number } = {},
): Promise<RunView[]> {
  const db = options.db ?? getDb();
  await loadOwn(userId, destinationId, db);
  const rows = await db
    .select(RUN_COLUMNS)
    .from(backupRuns)
    .where(eq(backupRuns.destinationId, destinationId))
    .orderBy(desc(backupRuns.startedAt))
    .limit(options.limit ?? 10);
  return rows.map(toRunView);
}

/**
 * Opens the transport of a destination: unseals its credentials, and keeps any
 * refresh token the provider rotates along the way.
 */
async function transportFor(
  db: Database,
  dest: typeof backupDestinations.$inferSelect,
  seams: Seams,
): Promise<BackupTransport> {
  const credentials = openCredentials(dest.id, dest.credentials);
  return (seams.openTransport ?? openTransport)(dest.provider, credentials, {
    onRefreshToken: async (refreshToken) => {
      // Providers that rotate the token expect the new one next time.
      const next = { ...(credentials as object), refreshToken };
      await db
        .update(backupDestinations)
        .set({ credentials: sealCredentials(dest.id, next) })
        .where(eq(backupDestinations.id, dest.id));
    },
  });
}

export interface BackupFile {
  readonly name: string;
  readonly takenAt: Date;
}

/** The backups at one of this person's destinations, newest first. */
export async function listBackupFiles(
  userId: string,
  destinationId: string,
  seams: Seams = {},
): Promise<BackupFile[]> {
  const db = seams.db ?? getDb();
  const dest = await loadOwn(userId, destinationId, db);
  const transport = await transportFor(db, dest, seams);
  const files: BackupFile[] = [];
  for (const name of await transport.list()) {
    const takenAt = parseBundleName(name);
    // Only files this feature wrote. Whatever else is in the folder is not for
    // a download button to hand out.
    if (takenAt) files.push({ name, takenAt });
  }
  return files.sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
}

/**
 * One backup, still encrypted, for the restore screen to decrypt in the browser.
 * The server reads ciphertext and passes ciphertext on.
 */
export async function readBackupFile(
  userId: string,
  destinationId: string,
  name: string,
  seams: Seams = {},
): Promise<Buffer> {
  if (parseBundleName(name) === null) throw new BackupInputError("notFound");
  const db = seams.db ?? getDb();
  const dest = await loadOwn(userId, destinationId, db);
  const transport = await transportFor(db, dest, seams);
  return transport.read(name);
}

// ── Running a backup ─────────────────────────────────────────────────────────

/**
 * Opens a run, unless one is already going. Null means "already going".
 *
 * Two things can ask at once — the scheduler, and a person pressing the
 * button — and writing the same files twice at once helps nobody. The advisory
 * lock makes "is one running? then start one" a single step.
 */
async function startRun(
  db: Database,
  destinationId: string,
  trigger: "schedule" | "manual",
  now: Date,
): Promise<string | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${destinationId}, 0))`,
    );
    const [running] = await tx
      .select({ id: backupRuns.id })
      .from(backupRuns)
      .where(
        and(
          eq(backupRuns.destinationId, destinationId),
          eq(backupRuns.status, "running"),
          gt(backupRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS)),
        ),
      )
      .limit(1);
    if (running) return null;
    const [row] = await tx
      .insert(backupRuns)
      .values({ destinationId, trigger, startedAt: now })
      .returning({ id: backupRuns.id });
    return row?.id ?? null;
  });
}

export type RequestResult =
  | { readonly status: "queued"; readonly runId: string }
  | { readonly status: "already-running" };

/** "Back up now": opens the run so the screen can show it, then queues the work. */
export async function requestRun(
  userId: string,
  destinationId: string,
  seams: Seams = {},
): Promise<RequestResult> {
  const db = seams.db ?? getDb();
  const now = (seams.now ?? (() => new Date()))();
  await loadOwn(userId, destinationId, db);

  const runId = await startRun(db, destinationId, "manual", now);
  if (!runId) return { status: "already-running" };

  const payload: BackupRunPayload = { destinationId, runId, trigger: "manual" };
  const queued = await publish(QUEUES.backupRun, payload, {
    retryLimit: 0,
    expireInSeconds: 2 * 60 * 60,
  }).catch(() => null);
  if (queued === null) {
    // No queue to hand it to (a demo instance, or the database blinked). The
    // run row must not be left claiming it is under way.
    await finishRun(db, runId, {
      status: "failed",
      errorCode: "unknown",
      errorDetail: "The job queue could not be reached.",
      finishedAt: now,
    });
    throw new BackupError("unknown", "The job queue could not be reached.");
  }
  return { status: "queued", runId };
}

async function finishRun(
  db: Database,
  runId: string,
  result: {
    status: RunView["status"];
    finishedAt: Date;
    groupCount?: number;
    bytes?: number;
    objectName?: string;
    receiptsWritten?: number;
    receiptsPending?: number;
    errorCode?: BackupErrorCode;
    errorDetail?: string;
  },
): Promise<void> {
  await db
    .update(backupRuns)
    .set({
      status: result.status,
      finishedAt: result.finishedAt,
      groupCount: result.groupCount ?? 0,
      bytes: result.bytes ?? 0,
      objectName: result.objectName ?? null,
      receiptsWritten: result.receiptsWritten ?? 0,
      receiptsPending: result.receiptsPending ?? 0,
      errorCode: result.errorCode ?? null,
      errorDetail: result.errorDetail ?? null,
    })
    .where(eq(backupRuns.id, runId));
}

export interface RunOptions extends Seams {
  readonly trigger: "schedule" | "manual";
  /** The run the requester already opened. Without one, this opens its own. */
  readonly runId?: string;
}

export interface RunOutcome {
  readonly runId: string;
  readonly status: "succeeded" | "unchanged" | "failed";
  readonly errorCode?: BackupErrorCode;
  /** Old backups deleted by the retention rule. */
  readonly deleted: readonly string[];
}

/**
 * Writes one encrypted backup to one destination.
 *
 * Returns null when there was nothing to do (the destination is gone or has
 * been switched off, or another run is already going).
 */
export async function runBackup(
  destinationId: string,
  options: RunOptions,
): Promise<RunOutcome | null> {
  const db = options.db ?? getDb();
  const clock = options.now ?? (() => new Date());
  const startedAt = clock();

  const [dest] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .limit(1);

  if (!dest || (options.trigger === "schedule" && dest.status !== "active")) {
    // A run the requester opened for something that has since gone away.
    if (options.runId) {
      await finishRun(db, options.runId, {
        status: "failed",
        errorCode: "unknown",
        errorDetail: "The destination was removed or switched off.",
        finishedAt: startedAt,
      });
    }
    return null;
  }

  const runId =
    options.runId ?? (await startRun(db, dest.id, options.trigger, startedAt));
  if (!runId) return null;

  const log = logger.child({
    module: "backup",
    destinationId: dest.id,
    runId,
    provider: dest.provider,
  });

  try {
    const key = await getBackupKey(dest.userId, { db });
    if (!key) {
      throw new BackupError(
        "no_key",
        "There is no recovery key to encrypt to.",
      );
    }

    const transport = await transportFor(db, dest, options);

    // Receipts first, so that the data backup lists exactly the ones that made
    // it. A run cut short by its budget lists what is there and no more, and
    // the next one carries on.
    let sync: ReceiptSync | undefined;
    if (dest.includeReceipts) {
      sync = await syncReceipts({
        receipts: await listReceipts(dest.userId, {
          excluding: dest.excludedGroupIds,
          db,
        }),
        recipient: key.recipient,
        transport,
        storage: options.storage ?? getStorage(),
        byteBudget: options.receiptByteBudget,
      });
    }

    const built = await buildBundle(dest.userId, {
      excluding: dest.excludedGroupIds,
      db,
      now: startedAt,
      receipts: sync?.manifest,
    });
    const receiptsWritten = sync?.written ?? 0;
    const receiptsPending = sync?.pending ?? 0;

    if (
      shouldSkipUnchanged({
        trigger: options.trigger,
        contentHash: built.contentHash,
        lastContentHash: dest.lastContentHash,
        lastSuccessAt: dest.lastSuccessAt,
        now: startedAt,
      })
    ) {
      const finishedAt = clock();
      await finishRun(db, runId, {
        status: "unchanged",
        finishedAt,
        groupCount: built.bundle.groups.length,
        receiptsWritten,
        receiptsPending,
      });
      await markSuccess(db, dest, finishedAt, built.contentHash, {
        keepSuccessAt: true,
        receiptsPending,
      });
      log.info("Backup skipped: nothing changed");
      return { runId, status: "unchanged", deleted: [] };
    }

    const encrypted = await encryptTo(
      key.recipient,
      serialiseBundle(built.bundle),
    );
    const name = bundleName(startedAt);

    await transport.ensureDirectory();
    await transport.put(name, encrypted);

    // Retention comes after the write, never before: a failure to prune must
    // not cost the new copy, and a failure to write must not cost an old one.
    const deleted: string[] = [];
    try {
      for (const stale of selectExpired(
        await transport.list(),
        dest.keepLast,
      )) {
        await transport.remove(stale);
        deleted.push(stale);
      }
    } catch (error) {
      log.warn(
        { err: error instanceof Error ? error.message : "unknown" },
        "Backup written, but old backups could not be pruned",
      );
    }

    const finishedAt = clock();
    await finishRun(db, runId, {
      status: "succeeded",
      finishedAt,
      groupCount: built.bundle.groups.length,
      bytes: encrypted.byteLength,
      objectName: name,
      receiptsWritten,
      receiptsPending,
    });
    await markSuccess(db, dest, finishedAt, built.contentHash, {
      receiptsPending,
    });
    log.info(
      {
        groups: built.bundle.groups.length,
        bytes: encrypted.byteLength,
        deleted: deleted.length,
        receiptsWritten,
        receiptsPending,
      },
      "Backup written",
    );
    return { runId, status: "succeeded", deleted };
  } catch (error) {
    const failure =
      error instanceof BackupError
        ? error
        : new BackupError(
            "unknown",
            scrub(error instanceof Error ? error.message : String(error)),
          );
    if (!(error instanceof BackupError)) {
      log.error({ err: error }, "Backup failed unexpectedly");
    } else {
      log.warn({ code: failure.code }, "Backup failed");
    }

    const finishedAt = clock();
    await finishRun(db, runId, {
      status: "failed",
      finishedAt,
      errorCode: failure.code,
      errorDetail: failure.detail,
    });
    await markFailure(db, dest, finishedAt, failure.code);
    return { runId, status: "failed", errorCode: failure.code, deleted: [] };
  }
}

async function markSuccess(
  db: Database,
  dest: typeof backupDestinations.$inferSelect,
  at: Date,
  contentHash: string,
  options: { keepSuccessAt?: boolean; receiptsPending?: number } = {},
): Promise<void> {
  await db
    .update(backupDestinations)
    .set({
      lastRunAt: at,
      // A skipped night checked, but it did not write: the last *copy* is still
      // the old one, and the weekly rewrite is counted from it.
      ...(options.keepSuccessAt ? {} : { lastSuccessAt: at }),
      lastContentHash: contentHash,
      consecutiveFailures: 0,
      // Receipts still waiting means the run stopped at its budget, not that
      // it is finished: come back within the hour rather than tomorrow, or a
      // big first backup takes a week to land.
      nextRunAt:
        (options.receiptsPending ?? 0) > 0
          ? new Date(at.getTime() + RECEIPT_CONTINUE_MS)
          : nextRunAfter(at, dest.frequency),
      status: dest.status === "needs_reconnect" ? "active" : dest.status,
      updatedAt: at,
    })
    .where(eq(backupDestinations.id, dest.id));
}

async function markFailure(
  db: Database,
  dest: typeof backupDestinations.$inferSelect,
  at: Date,
  code: BackupErrorCode,
): Promise<void> {
  const failures = dest.consecutiveFailures + 1;
  await db
    .update(backupDestinations)
    .set({
      lastRunAt: at,
      consecutiveFailures: failures,
      nextRunAt: new Date(at.getTime() + retryDelayMs(failures)),
      // Retrying a revoked token only annoys the provider. The destination
      // waits for the person.
      status:
        (code === "reconnect" || code === "app") && dest.status === "active"
          ? "needs_reconnect"
          : dest.status,
      updatedAt: at,
    })
    .where(eq(backupDestinations.id, dest.id));
}

// ── The scheduler's half ─────────────────────────────────────────────────────

/** Runs left "running" by a process that died are closed as failed. */
export async function reapStaleRuns(
  now: Date,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const closed = await db
    .update(backupRuns)
    .set({
      status: "failed",
      finishedAt: now,
      errorCode: "unknown",
      errorDetail: "The server stopped before this backup finished.",
    })
    .where(
      and(
        eq(backupRuns.status, "running"),
        lte(backupRuns.startedAt, new Date(now.getTime() - STALE_RUN_MS)),
      ),
    )
    .returning({ id: backupRuns.id });
  return closed.length;
}

/** A connection that waited a day for step 4 and never got it is let go. */
export async function reapStaleSetups(
  now: Date,
  options: { db?: Database } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const removed = await db
    .delete(backupDestinations)
    .where(
      and(
        eq(backupDestinations.status, "setup"),
        lte(
          backupDestinations.createdAt,
          new Date(now.getTime() - SETUP_GRACE_MS),
        ),
      ),
    )
    .returning({ id: backupDestinations.id });
  return removed.length;
}

/** Queues one run for every destination whose time has come. */
export async function sweepDueBackups(
  options: { db?: Database; now?: Date } = {},
): Promise<{ queued: number }> {
  const db = options.db ?? getDb();
  const now = options.now ?? new Date();
  await reapStaleRuns(now, { db });
  await reapStaleSetups(now, { db });

  const due = await db
    .select({ id: backupDestinations.id })
    .from(backupDestinations)
    .where(
      and(
        eq(backupDestinations.status, "active"),
        lte(backupDestinations.nextRunAt, now),
      ),
    )
    .orderBy(asc(backupDestinations.nextRunAt))
    .limit(100);

  let queued = 0;
  for (const { id } of due) {
    const runId = await startRun(db, id, "schedule", now);
    if (!runId) continue;
    const payload: BackupRunPayload = {
      destinationId: id,
      runId,
      trigger: "schedule",
    };
    const sent = await publish(QUEUES.backupRun, payload, {
      retryLimit: 0,
      expireInSeconds: 2 * 60 * 60,
    }).catch(() => null);
    if (sent === null) {
      await finishRun(db, runId, {
        status: "failed",
        errorCode: "unknown",
        errorDetail: "The job queue could not be reached.",
        finishedAt: now,
      });
      continue;
    }
    queued += 1;
  }
  return { queued };
}

/** Keeps the thirty newest runs of each destination, and anything newer than `before`. */
export async function pruneRuns(
  before: Date,
  options: { db?: Database; keep?: number } = {},
): Promise<number> {
  const db = options.db ?? getDb();
  const keep = options.keep ?? 30;
  const removed = await db.execute(sql`
    DELETE FROM ${backupRuns}
    WHERE ${backupRuns.startedAt} < ${before}
      AND ${backupRuns.id} NOT IN (
        SELECT id FROM (
          SELECT id, row_number() OVER (
            PARTITION BY destination_id ORDER BY started_at DESC
          ) AS position
          FROM ${backupRuns}
        ) ranked
        WHERE position <= ${keep}
      )
  `);
  return removed.rowCount ?? 0;
}
