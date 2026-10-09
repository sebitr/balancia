import "server-only";
import { BackupError } from "./errors";
import {
  buildAuthorizeUrl,
  challengeFor,
  randomToken,
  resolveApp,
  type OAuthKind,
} from "./oauth";
import { ttlExpiry, type PendingConnection } from "./oauth-state";
import type { OwnOAuthApp } from "./providers";
import {
  BackupInputError,
  getBackupKey,
  getDestinationApp,
  type Seams,
} from "./service";

/**
 * Setting out for the provider: which app to act as, and where to send the
 * person.
 *
 * Two doors lead here — the start route, a plain link followed by a browser,
 * and an action, called with the details a person pasted — and they must not
 * differ in what they check or what they remember, so both ask this.
 *
 * It returns the address to go to and what the way back must recognise; it
 * sets nothing. Writing the cookie needs a request, and the domain does not
 * touch one.
 */

export interface Begun {
  readonly pending: PendingConnection;
  readonly url: URL;
}

export async function beginConnection(
  input: {
    readonly userId: string;
    readonly kind: OAuthKind;
    /** The app the person pasted. Without one, a reconnect keeps its own and a new connection uses the operator's. */
    readonly app?: OwnOAuthApp;
    /** Re-authorise this destination instead of adding one. */
    readonly reconnectId?: string;
  },
  seams: Seams = {},
): Promise<Begun> {
  // A connection with nothing to encrypt to would be refused on its first run.
  if (!(await getBackupKey(input.userId, seams))) {
    throw new BackupInputError("noKey");
  }

  // A reconnect goes back through the app the token was issued to. It is read
  // from the sealed row because the browser was never sent the secret; a
  // destination that is not theirs answers as one that does not exist.
  const app =
    input.app ??
    (input.reconnectId
      ? await getDestinationApp(input.userId, input.reconnectId, seams)
      : undefined);

  // Refused here, not after the person has been sent away to find out.
  if (!resolveApp(input.kind, app)) {
    throw new BackupError("app", `There is no ${input.kind} app to use.`);
  }

  const state = randomToken();
  const verifier = randomToken(48);
  const pending: PendingConnection = {
    kind: input.kind,
    state,
    verifier,
    userId: input.userId,
    reconnectId: input.reconnectId,
    app,
    expiresAt: ttlExpiry(),
  };
  return {
    pending,
    url: buildAuthorizeUrl(input.kind, {
      state,
      challenge: challengeFor(verifier),
      app,
    }),
  };
}
