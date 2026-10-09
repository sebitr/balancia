import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { backupDestinations } from "@/lib/db/schema";
import { BackupError } from "./errors";
import {
  describeAccount,
  exchangeCode,
  PROVIDER_OF,
  type OAuthKind,
} from "./oauth";
import type { OwnOAuthApp } from "./providers";
import {
  createDestination,
  replaceCredentials,
  BackupInputError,
  type Seams,
} from "./service";

/**
 * The last step of connecting a Google Drive, a Dropbox or a OneDrive: the
 * provider has sent the person back with a code.
 *
 * Kept out of the route so that the part with consequences — what gets stored,
 * for whom, and what a reconnect is allowed to overwrite — has tests, and the
 * route is left with only the redirects.
 */

export interface ConnectDeps {
  readonly exchangeCode: typeof exchangeCode;
  readonly describeAccount: typeof describeAccount;
}

export interface Connected {
  readonly destinationId: string;
  readonly reconnected: boolean;
}

export async function completeConnection(
  input: {
    readonly userId: string;
    readonly kind: OAuthKind;
    readonly code: string;
    readonly verifier: string;
    /** Set when the person came from "Reconnect" on an existing destination. */
    readonly reconnectId?: string;
    /**
     * The person's own app, when the trip was made through one. It is kept
     * with the token: the token only works for the app it was issued to.
     */
    readonly app?: OwnOAuthApp;
  },
  seams: Seams & { readonly deps?: ConnectDeps } = {},
): Promise<Connected> {
  const deps = seams.deps ?? { exchangeCode, describeAccount };
  const provider = PROVIDER_OF[input.kind];
  const db = seams.db ?? getDb();

  // Checked before the code is spent: a reconnect aimed at a destination that
  // is not theirs, or not this provider's, must not cost a token exchange.
  if (input.reconnectId) {
    const [existing] = await db
      .select({
        userId: backupDestinations.userId,
        provider: backupDestinations.provider,
      })
      .from(backupDestinations)
      .where(eq(backupDestinations.id, input.reconnectId))
      .limit(1);
    if (!existing || existing.userId !== input.userId) {
      throw new BackupInputError("notFound");
    }
    if (existing.provider !== provider) {
      throw new BackupError(
        "reconnect",
        "That destination belongs to a different provider.",
      );
    }
  }

  const tokens = await deps.exchangeCode(input.kind, {
    code: input.code,
    verifier: input.verifier,
    app: input.app,
  });
  const connected = await deps.describeAccount(input.kind, tokens.accessToken);

  const credentials = {
    refreshToken: tokens.refreshToken,
    account: connected.account || undefined,
    ...(connected.onedrive ?? {}),
    ...(input.app ? { app: input.app } : {}),
  };

  if (input.reconnectId) {
    await replaceCredentials(
      input.userId,
      input.reconnectId,
      credentials,
      seams,
    );
    return { destinationId: input.reconnectId, reconnected: true };
  }

  // A connection waiting for step 4, not yet a commitment: the person has not
  // said which groups or how often, and the wizard's draft did not survive the
  // trip to the provider. `finishSetup` makes it real and the caller starts the
  // first run.
  const { id } = await createDestination(
    input.userId,
    { provider, credentials, draft: true },
    seams,
  );
  return { destinationId: id, reconnected: false };
}
