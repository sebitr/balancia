"use server";

import { revalidatePath } from "next/cache";
import { getTranslations } from "next-intl/server";
import { z } from "zod";
import { actionError, runAction, type ActionResult } from "@/lib/actions";
import { getCurrentUser } from "@/lib/security/actor";
import {
  consumeRateLimit,
  RateLimitedError,
  type RateLimitBucket,
} from "@/lib/security/rate-limit";
import { setPendingConnection } from "@/app/api/backup/oauth/cookie";
import { beginConnection } from "./begin";
import { BackupError, type BackupErrorCode } from "./errors";
import { KIND_OF } from "./oauth";
import { BACKUP_PROVIDERS, oauthAppSchema, PROVIDERS } from "./providers";
import { estimateReceipts } from "./receipts";
import {
  BackupInputError,
  createDestination,
  deleteDestination,
  finishSetup,
  replaceCredentials,
  requestRun,
  saveBackupKey,
  testDestination,
  updateDestination,
  type BackupInputCode,
} from "./service";

/**
 * What the backup screens can ask the server to do.
 *
 * Every function here acts on the caller's own rows and takes no user id; the
 * service looks everything up through the signed-in account, so an id that
 * belongs to somebody else finds nothing and answers like one that never existed.
 *
 * ## Refusals are codes, not sentences
 *
 * A failed backup step is not an error in the server's sense — a bucket policy,
 * a full Dropbox, a mistyped password are ordinary outcomes the screen has a
 * sentence ready for. So a refusal comes back as `{ ok: false, code, detail }`
 * inside a *successful* action result, and the client words it in the reader's
 * language, from its own catalogue (`cloudBackup.error`). `detail` is the
 * provider's own words, scrubbed of anything secret and cut short, for the
 * person who needs to know *which* bucket policy.
 *
 * Only a genuine fault — a bug, a database that vanished — is a failed action,
 * and it gets the generic message and a log line like everywhere else.
 */

export type BackupOutcome<T = null> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly code: BackupErrorCode | BackupInputCode;
      readonly detail: string;
    };

async function attempt<T>(body: () => Promise<T>): Promise<BackupOutcome<T>> {
  try {
    return { ok: true, value: await body() };
  } catch (error) {
    if (error instanceof BackupError) {
      return { ok: false, code: error.code, detail: error.detail };
    }
    if (error instanceof BackupInputError) {
      return { ok: false, code: error.code, detail: "" };
    }
    throw error;
  }
}

async function spend(bucket: RateLimitBucket, userId: string): Promise<void> {
  const limit = await consumeRateLimit(bucket, userId);
  if (!limit.allowed) throw new RateLimitedError(limit.retryAfterSeconds);
}

/** Refreshes the settings hub (its row summarises this) and the screen itself. */
function refresh(): void {
  revalidatePath("/settings");
  revalidatePath("/settings/backup");
}

const frequency = z.enum(["daily", "weekly"]);
const keepLast = z.number().int().min(1).max(100);
const groupIds = z.array(z.uuid()).max(500);
const destinationId = z.uuid();

/** Credentials are validated by the provider's own schema, in the service. */
const credentials = z.record(z.string(), z.unknown());

async function requireUser() {
  const user = await getCurrentUser();
  if (!user) {
    const t = await getTranslations("serverErrors");
    return { user: null, refusal: actionError(t("signedInRequired")) } as const;
  }
  return { user, refusal: null } as const;
}

async function malformed() {
  const t = await getTranslations("serverErrors");
  return actionError(t("malformedRequest"));
}

/**
 * Stores the public half of the recovery key the browser just made.
 *
 * The private half is not an argument to anything on this page, and a client
 * that sent it by mistake is refused by the service — see `saveBackupKey`.
 */
export async function saveRecoveryKeyAction(
  recipient: string,
): Promise<ActionResult<BackupOutcome<{ fingerprint: string }>>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  if (typeof recipient !== "string" || recipient.length > 500) {
    return malformed();
  }

  return runAction("saveBackupKey", async () => {
    const outcome = await attempt(async () => {
      const saved = await saveBackupKey(user.userId, recipient);
      return { fingerprint: saved.fingerprint };
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}

/** Proves a set of typed details works, without keeping them. */
export async function testDestinationAction(
  input: z.input<typeof testSchema>,
): Promise<ActionResult<BackupOutcome>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsed = testSchema.safeParse(input);
  if (!parsed.success) return malformed();
  const { provider, credentials: details } = parsed.data;
  // The OAuth providers are connected by the redirect, never by typed details.
  if (PROVIDERS[provider].kind !== "credentials") return malformed();

  return runAction("testBackupDestination", async () => {
    await spend("backupTest", user.userId);
    return attempt(async () => {
      await testDestination(provider, details);
      return null;
    });
  });
}

const testSchema = z.object({
  provider: z.enum(BACKUP_PROVIDERS),
  credentials,
});

const ownAppSchema = z.object({
  provider: z.enum(["google_drive", "dropbox", "onedrive"]),
  clientId: z.string().max(1000),
  clientSecret: z.string().max(2000),
});

/**
 * Sets out for Google, Dropbox or Microsoft through an app the person
 * registered themselves, and answers with the provider's address to go to.
 *
 * A client secret cannot ride in a link — it would sit in the history, in the
 * server's logs and in the `Referer` of whatever the provider's page loads —
 * so it is posted here, kept in the sealed cookie the trip already uses, and
 * what comes back is only the address to navigate to. The page does that with
 * a plain assignment, not a form or a fetch: the page's `form-action 'self'`
 * would refuse a form whose answer redirects to the provider.
 *
 * Nothing is saved yet. The app is stored, sealed, with the connection the
 * callback makes, and only if the provider accepts it.
 */
export async function beginOwnAppConnectionAction(
  input: z.input<typeof ownAppSchema>,
): Promise<ActionResult<BackupOutcome<{ url: string }>>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsed = ownAppSchema.safeParse(input);
  if (!parsed.success) return malformed();

  const app = oauthAppSchema.safeParse({
    clientId: parsed.data.clientId,
    clientSecret: parsed.data.clientSecret,
  });

  return runAction("beginBackupConnection", async () => {
    await spend("backupTest", user.userId);
    return attempt(async () => {
      if (!app.success) throw new BackupInputError("invalidDetails");
      const { pending, url } = await beginConnection({
        userId: user.userId,
        kind: KIND_OF[parsed.data.provider],
        app: app.data,
      });
      await setPendingConnection(pending);
      return { url: url.toString() };
    });
  });
}

/** What step 4 of the wizard decides, whichever way the destination was connected. */
const choicesSchema = z.object({
  frequency,
  keepLast,
  excludedGroupIds: groupIds,
  includeReceipts: z.boolean(),
  /**
   * A destination this one stands in for ("Where to back up → Change"). It is
   * forgotten once the new one is in place; what it already wrote to its cloud
   * stays there.
   */
  replaces: destinationId.optional(),
});

const createSchema = choicesSchema.extend({
  provider: z.enum(BACKUP_PROVIDERS),
  credentials,
});

/** Forgets the destination a new one replaces, if the person has one in mind. */
async function forgetReplaced(
  userId: string,
  replaces: string | undefined,
  keep: string,
): Promise<void> {
  if (replaces && replaces !== keep) {
    await deleteDestination(userId, replaces);
  }
}

/**
 * Keeps a destination made of typed details, and starts its first backup.
 *
 * For the providers that are connected by typing — a bucket, a WebDAV server,
 * Proton Drive. The ones connected by a trip to the provider are made by the
 * OAuth return and finished by `finishSetupAction`, because the page that held
 * the wizard's choices is gone by then.
 *
 * The first run is the real proof that it works end to end, so it is queued at
 * once instead of waiting for the night. A queue that is down only delays it:
 * the schedule picks the destination up within minutes.
 */
export async function createDestinationAction(
  input: z.input<typeof createSchema>,
): Promise<ActionResult<BackupOutcome<{ id: string }>>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) return malformed();
  if (PROVIDERS[parsed.data.provider].kind !== "credentials") {
    return malformed();
  }

  return runAction("createBackupDestination", async () => {
    await spend("backupTest", user.userId);
    const { replaces, ...rest } = parsed.data;
    const outcome = await attempt(async () => {
      const { id } = await createDestination(user.userId, rest);
      await forgetReplaced(user.userId, replaces, id);
      await requestRun(user.userId, id).catch(() => undefined);
      return { id };
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}

const finishSchema = choicesSchema.extend({ id: destinationId });

/**
 * Step 4 for a destination the OAuth return made: the person has said which
 * groups and how often, and the connection becomes a destination that runs.
 */
export async function finishSetupAction(
  input: z.input<typeof finishSchema>,
): Promise<ActionResult<BackupOutcome<{ id: string }>>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsed = finishSchema.safeParse(input);
  if (!parsed.success) return malformed();

  return runAction("finishBackupSetup", async () => {
    const { id, replaces, ...choices } = parsed.data;
    const outcome = await attempt(async () => {
      await finishSetup(user.userId, id, choices);
      await forgetReplaced(user.userId, replaces, id);
      await requestRun(user.userId, id).catch(() => undefined);
      return { id };
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}

/**
 * What switching receipts on would send, for the groups as they are ticked.
 *
 * A number a person can weigh against their cloud quota is worth more than any
 * amount of explanation, so the screens ask this each time the ticks change.
 */
export async function estimateReceiptsAction(
  excludedGroupIds: string[],
): Promise<ActionResult<{ count: number; bytes: number }>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsed = groupIds.safeParse(excludedGroupIds);
  if (!parsed.success) return malformed();

  return runAction("estimateBackupReceipts", async () => {
    return estimateReceipts(user.userId, { excluding: parsed.data });
  });
}

const patchSchema = z
  .object({
    frequency,
    keepLast,
    excludedGroupIds: groupIds,
    includeReceipts: z.boolean(),
    paused: z.boolean(),
  })
  .partial();

export async function updateDestinationAction(
  id: string,
  patch: z.input<typeof patchSchema>,
): Promise<ActionResult<BackupOutcome>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsedId = destinationId.safeParse(id);
  const parsed = patchSchema.safeParse(patch);
  if (!parsedId.success || !parsed.success) return malformed();

  return runAction("updateBackupDestination", async () => {
    const outcome = await attempt(async () => {
      await updateDestination(user.userId, parsedId.data, parsed.data);
      return null;
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}

/** New typed details for a destination that stopped accepting the old ones. */
export async function replaceCredentialsAction(
  id: string,
  details: Record<string, unknown>,
): Promise<ActionResult<BackupOutcome>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsedId = destinationId.safeParse(id);
  const parsed = credentials.safeParse(details);
  if (!parsedId.success || !parsed.success) return malformed();

  return runAction("replaceBackupCredentials", async () => {
    await spend("backupTest", user.userId);
    const outcome = await attempt(async () => {
      await replaceCredentials(user.userId, parsedId.data, parsed.data);
      return null;
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}

/**
 * Forgets a destination. What is already in the cloud stays there: the files
 * are the person's, and Balancia only ever deletes the ones its own retention
 * rule names, and only while it is still connected.
 */
export async function removeDestinationAction(
  id: string,
): Promise<ActionResult<BackupOutcome>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsedId = destinationId.safeParse(id);
  if (!parsedId.success) return malformed();

  return runAction("removeBackupDestination", async () => {
    const outcome = await attempt(async () => {
      await deleteDestination(user.userId, parsedId.data);
      return null;
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}

/** "Back up now". Returns at once; the screen watches the run it opened. */
export async function runBackupNowAction(
  id: string,
): Promise<ActionResult<BackupOutcome<{ started: boolean }>>> {
  const { user, refusal } = await requireUser();
  if (!user) return refusal;
  const parsedId = destinationId.safeParse(id);
  if (!parsedId.success) return malformed();

  return runAction("runBackupNow", async () => {
    await spend("backupRun", user.userId);
    const outcome = await attempt(async () => {
      const result = await requestRun(user.userId, parsedId.data);
      return { started: result.status === "queued" };
    });
    if (outcome.ok) refresh();
    return outcome;
  });
}
