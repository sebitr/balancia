import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getEnv, type BackupOAuthApp } from "@/lib/env";
import { BackupError, classify, scrub } from "./errors";
import type { BackupProvider } from "./providers";

/**
 * Connecting a Google Drive, a Dropbox or a OneDrive.
 *
 * The person is sent to the provider, agrees, and comes back with a code;
 * Balancia trades the code for a **refresh token** and keeps that, sealed. No
 * password is ever typed here. It is the standard authorization-code flow with
 * PKCE, and `state` binds the way back to the browser that set out (see
 * `routes`: it lives in a sealed cookie, not on a server).
 *
 * ## The narrowest permission each provider offers
 *
 * A backup needs to write its own files and nothing else, so each is asked for
 * exactly that — and the choice is the point, because a refresh token is a
 * standing key to whatever it was granted:
 *
 *  - **Google** `drive.file`: only files this app created. Balancia cannot
 *    list, read or touch anything else in the person's Drive.
 *  - **Dropbox**: the app must be registered as an *app folder* app, which
 *    confines it to `Apps/<name>/`. That is the registrant's choice, not a
 *    scope we can ask for, so `docs/cloud-backup.md` says so in the steps.
 *  - **OneDrive** `Files.ReadWrite.AppFolder`: the app's own folder. Microsoft
 *    offers it for **personal accounts only**; a work or school account has no
 *    app folder, so those are sent to the personal-accounts authority and
 *    cannot connect. The alternative — `Files.ReadWrite` — would let a stolen
 *    token read the whole OneDrive, which is not a price worth paying for a
 *    convenience.
 *
 * ## Whose app
 *
 * Every call takes the app to act as, and falls back to the instance's
 * (`BACKUP_*_CLIENT_ID`) only when it is not given one. A person's own app is
 * what lets this work on a server whose operator registered nothing, and keeps
 * one person's revoked or rate-limited app from stopping everybody else's
 * backups; the instance's is the convenience for a server that wants a single
 * button. The app is a property of the *connection* — a refresh token only
 * works with the client it was issued to — so it is stored with the token and
 * handed back here on every refresh.
 *
 * Nothing here has been run against the three live providers by the people who
 * wrote it; the requests follow each provider's published reference and are
 * tested against recorded shapes of their answers. See the checklist at the
 * end of `docs/cloud-backup.md`.
 */

export type OAuthKind = "google" | "dropbox" | "microsoft";

export const OAUTH_KINDS: readonly OAuthKind[] = [
  "google",
  "dropbox",
  "microsoft",
];

export const KIND_OF: Readonly<
  Record<"google_drive" | "dropbox" | "onedrive", OAuthKind>
> = {
  google_drive: "google",
  dropbox: "dropbox",
  onedrive: "microsoft",
};

export const PROVIDER_OF: Readonly<Record<OAuthKind, BackupProvider>> = {
  google: "google_drive",
  dropbox: "dropbox",
  microsoft: "onedrive",
};

export function isOAuthKind(value: string): value is OAuthKind {
  return (OAUTH_KINDS as readonly string[]).includes(value);
}

/** The app the operator registered for everybody on this server, if they did. */
export function oauthApp(kind: OAuthKind): BackupOAuthApp | undefined {
  return getEnv().backupOAuthApps[kind];
}

/** The app a connection acts as: its own if it has one, else the operator's. */
export function resolveApp(
  kind: OAuthKind,
  own?: BackupOAuthApp,
): BackupOAuthApp | undefined {
  return own ?? oauthApp(kind);
}

export function redirectUri(kind: OAuthKind): string {
  return `${getEnv().appOrigin}/api/backup/oauth/${kind}/callback`;
}

const ENDPOINTS = {
  google: {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
  },
  dropbox: {
    authorize: "https://www.dropbox.com/oauth2/authorize",
    token: "https://api.dropboxapi.com/oauth2/token",
  },
  microsoft: {
    // `consumers`, on purpose: see the note on app folders above.
    authorize:
      "https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize",
    token: "https://login.microsoftonline.com/consumers/oauth2/v2.0/token",
  },
} as const;

const SCOPES = {
  google: ["https://www.googleapis.com/auth/drive.file"],
  dropbox: [
    "files.metadata.read",
    "files.metadata.write",
    "files.content.read",
    "files.content.write",
    "account_info.read",
  ],
  microsoft: ["offline_access", "Files.ReadWrite.AppFolder", "User.Read"],
} as const satisfies Record<OAuthKind, readonly string[]>;

/** A random string for `state` or a PKCE verifier. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function challengeFor(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(
  kind: OAuthKind,
  input: { state: string; challenge: string; app?: BackupOAuthApp },
): URL {
  const app = requireApp(kind, input.app);
  const url = new URL(ENDPOINTS[kind].authorize);
  const params = url.searchParams;
  params.set("client_id", app.clientId);
  params.set("redirect_uri", redirectUri(kind));
  params.set("response_type", "code");
  params.set("scope", SCOPES[kind].join(" "));
  params.set("state", input.state);
  params.set("code_challenge", input.challenge);
  params.set("code_challenge_method", "S256");

  if (kind === "google") {
    // Without both, Google hands a refresh token to the first consent only,
    // and a person who reconnects gets an access token that dies in an hour.
    params.set("access_type", "offline");
    params.set("prompt", "consent");
  } else if (kind === "dropbox") {
    params.set("token_access_type", "offline");
  } else {
    params.set("response_mode", "query");
  }
  return url;
}

export interface TokenSet {
  readonly accessToken: string;
  /** Absent when the provider kept the one it had already given. */
  readonly refreshToken?: string;
  readonly expiresAt: Date;
}

const TIMEOUT_MS = 20_000;

interface TokenResponse {
  readonly access_token?: unknown;
  readonly refresh_token?: unknown;
  readonly expires_in?: unknown;
  readonly error?: unknown;
  readonly error_description?: unknown;
}

async function postForm(
  url: string,
  body: Record<string, string>,
  secrets: readonly string[],
): Promise<TokenResponse> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new BackupError(
      "unreachable",
      scrub(error instanceof Error ? error.message : "network error", secrets),
    );
  }

  let parsed: TokenResponse = {};
  try {
    parsed = (await response.json()) as TokenResponse;
  } catch {
    // An error page rather than JSON; the status below says enough.
  }
  if (!response.ok) {
    const said = [parsed.error, parsed.error_description]
      .filter((part): part is string => typeof part === "string")
      .join(": ");
    // `invalid_client` is the provider not knowing the app, which asking the
    // person to connect again through the same app would not mend. Checked
    // first because Microsoft answers it with a 401, which on its own reads as
    // a revoked token. `invalid_grant` is the other answer: the person took
    // access back, or the token aged out, and that one does mean "ask them
    // again".
    const code =
      parsed.error === "invalid_client" ||
      parsed.error === "unauthorized_client"
        ? "app"
        : parsed.error === "invalid_grant" || response.status === 401
          ? "reconnect"
          : classify(`${response.status} ${said}`);
    throw new BackupError(
      code,
      scrub(said || `The provider answered ${response.status}.`, secrets),
    );
  }
  return parsed;
}

function toTokenSet(body: TokenResponse, now: Date): TokenSet {
  if (typeof body.access_token !== "string" || body.access_token === "") {
    throw new BackupError("unknown", "The provider sent no access token.");
  }
  const seconds =
    typeof body.expires_in === "number" && body.expires_in > 0
      ? body.expires_in
      : 3600;
  return {
    accessToken: body.access_token,
    refreshToken:
      typeof body.refresh_token === "string" && body.refresh_token !== ""
        ? body.refresh_token
        : undefined,
    expiresAt: new Date(now.getTime() + seconds * 1000),
  };
}

function requireApp(kind: OAuthKind, own?: BackupOAuthApp): BackupOAuthApp {
  const app = resolveApp(kind, own);
  if (!app) {
    // Nobody to act as: no app of the person's own, and none for the server.
    throw new BackupError("app", `There is no ${kind} app to connect through.`);
  }
  return app;
}

/** Trades the one-time code for tokens. */
export async function exchangeCode(
  kind: OAuthKind,
  input: { code: string; verifier: string; app?: BackupOAuthApp },
  now = new Date(),
): Promise<TokenSet & { readonly refreshToken: string }> {
  const app = requireApp(kind, input.app);
  const body = await postForm(
    ENDPOINTS[kind].token,
    {
      grant_type: "authorization_code",
      code: input.code,
      redirect_uri: redirectUri(kind),
      client_id: app.clientId,
      client_secret: app.clientSecret,
      code_verifier: input.verifier,
    },
    [input.code, input.verifier, app.clientSecret],
  );
  const tokens = toTokenSet(body, now);
  if (!tokens.refreshToken) {
    // Without one the connection would work for an hour and then never again.
    throw new BackupError(
      "reconnect",
      "The provider did not grant lasting access. Try connecting again.",
    );
  }
  return { ...tokens, refreshToken: tokens.refreshToken };
}

/**
 * A fresh access token from a stored refresh token.
 *
 * Providers that rotate refresh tokens (Microsoft does) answer with a new one;
 * the caller must store it, or the next run presents a token that may already
 * have been spent.
 */
export async function refreshAccessToken(
  kind: OAuthKind,
  refreshToken: string,
  now = new Date(),
  own?: BackupOAuthApp,
): Promise<TokenSet> {
  const app = requireApp(kind, own);
  const body = await postForm(
    ENDPOINTS[kind].token,
    {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: app.clientId,
      client_secret: app.clientSecret,
      ...(kind === "microsoft" ? { scope: SCOPES.microsoft.join(" ") } : {}),
    },
    [refreshToken, app.clientSecret],
  );
  return toTokenSet(body, now);
}

export interface ConnectedAccount {
  /** What to show beside the provider's name: an address, usually. */
  readonly account: string;
  /** OneDrive only: where its app folder is. */
  readonly onedrive?: {
    readonly driveId: string;
    readonly driveType: "personal" | "business" | "documentLibrary";
    readonly rootFolderId: string;
  };
}

async function getJson(
  url: string,
  accessToken: string,
  init: RequestInit = {},
): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(init.headers as Record<string, string> | undefined),
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new BackupError(
      "unreachable",
      scrub(error instanceof Error ? error.message : "network error", [
        accessToken,
      ]),
    );
  }
  if (!response.ok) {
    throw new BackupError(
      response.status === 401 ? "reconnect" : classify(String(response.status)),
      `The provider answered ${response.status} when asked who connected.`,
    );
  }
  return (await response.json()) as Record<string, unknown>;
}

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;

/** Asks the provider whose account this is, so the screen can say so. */
export async function describeAccount(
  kind: OAuthKind,
  accessToken: string,
): Promise<ConnectedAccount> {
  if (kind === "google") {
    const about = await getJson(
      "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress,displayName)",
      accessToken,
    );
    const user = (about.user ?? {}) as Record<string, unknown>;
    return { account: text(user.emailAddress) ?? text(user.displayName) ?? "" };
  }

  if (kind === "dropbox") {
    const me = await getJson(
      "https://api.dropboxapi.com/2/users/get_current_account",
      accessToken,
      { method: "POST" },
    );
    return { account: text(me.email) ?? "" };
  }

  const me = await getJson(
    "https://graph.microsoft.com/v1.0/me?$select=userPrincipalName,mail,displayName",
    accessToken,
  );
  const folder = await getJson(
    "https://graph.microsoft.com/v1.0/me/drive/special/approot?$select=id,parentReference",
    accessToken,
  );
  const parent = (folder.parentReference ?? {}) as Record<string, unknown>;
  const driveId = text(parent.driveId);
  const rootFolderId = text(folder.id);
  if (!driveId || !rootFolderId) {
    throw new BackupError(
      "unknown",
      "OneDrive did not say where the app folder is.",
    );
  }
  const driveType = text(parent.driveType);
  return {
    account:
      text(me.mail) ?? text(me.userPrincipalName) ?? text(me.displayName) ?? "",
    onedrive: {
      driveId,
      driveType:
        driveType === "business" || driveType === "documentLibrary"
          ? driveType
          : "personal",
      rootFolderId,
    },
  };
}
