import "server-only";
import { getEnv } from "@/lib/env";
import { assertEndpointAllowed } from "./endpoint-guard";
import { BackupError } from "./errors";
import { KIND_OF, oauthApp, refreshAccessToken, resolveApp } from "./oauth";
import {
  credentialSchemas,
  PROVIDERS,
  type BackupProvider,
  type CredentialsOf,
} from "./providers";
import * as rclone from "./rclone";
import {
  buildRemote,
  inFolder,
  type BackupSubfolder,
  type OAuthToken,
  type RcloneRemote,
} from "./rclone-config";

/**
 * A place to put files, as the backup code sees it.
 *
 * Six operations and no provider names: whether the bytes go to a bucket, a
 * Drive folder or a NAS is decided once, here, and everything above this
 * line — the run, retention, the connection test — is written against the
 * interface. It is also the seam the tests use: a fake that remembers files in
 * a map exercises the whole run against a real database without a network.
 */
export interface BackupTransport {
  /** Writes, lists and deletes a file, as a real run will. Throws `BackupError`. */
  check(): Promise<void>;
  /** `folder` aims the call at a folder inside the backup folder; none, at the backup folder. */
  ensureDirectory(folder?: BackupSubfolder): Promise<void>;
  put(name: string, bytes: Uint8Array, folder?: BackupSubfolder): Promise<void>;
  list(folder?: BackupSubfolder): Promise<string[]>;
  remove(name: string, folder?: BackupSubfolder): Promise<void>;
  read(name: string, folder?: BackupSubfolder): Promise<Buffer>;
}

export interface OpenOptions {
  /**
   * Called when the provider rotated the refresh token, with the new one.
   * Microsoft does on every refresh; if it is not kept, the next run presents a
   * token that may already be spent. It can be called more than once: when
   * the transport is opened, and again before any call made after the access
   * token has run low.
   */
  readonly onRefreshToken?: (refreshToken: string) => Promise<void>;
  /** The time, for a test. */
  readonly now?: () => Date;
}

/**
 * How long an access token must still have to run when an rclone call starts.
 *
 * Longer than the longest call (ten minutes, `rclone.ts`'s default deadline),
 * so that rclone never has to refresh the token itself. It can — the refresh
 * token is in its environment — but it cannot keep what it gets back: with the
 * remote defined by environment variables there is no config section to save
 * into, and rclone says so ("Not saving config "token" as section "BACKUP" is
 * not in the config file") and carries on. A provider that rotated the refresh
 * token during that refresh would leave this destination holding a spent one.
 * So the token is refreshed here, where the new one is kept, before any call
 * that could outlive it.
 */
export const TOKEN_MARGIN_MS = 15 * 60_000;

/**
 * Whether this instance can offer a provider at all, and if not, why.
 *
 * Google Drive, Dropbox and OneDrive are always available: when the operator
 * has registered no app for them, the owner brings their own. Whether there is
 * an app for everybody is a separate fact — `instanceApp` — because it decides
 * only whether a screen offers one button or asks for a client ID.
 */
export function providerAvailability(
  provider: BackupProvider,
): "available" | "experimental_off" | "not_offered" {
  const info = PROVIDERS[provider];
  if (!info.offered) return "not_offered";
  if (info.experimental && !getEnv().BACKUP_EXPERIMENTAL_PROVIDERS) {
    return "experimental_off";
  }
  return "available";
}

/** Whether the operator registered an app that anyone on this server can connect through. */
export function instanceApp(provider: BackupProvider): boolean {
  if (PROVIDERS[provider].kind !== "oauth") return false;
  return oauthApp(KIND_OF[provider as keyof typeof KIND_OF]) !== undefined;
}

/** The address a credentials provider will connect to, if it has one that a person chose. */
function endpointOf(
  provider: BackupProvider,
  credentials: unknown,
): string | null {
  if (provider === "s3") {
    const { endpoint } = credentials as CredentialsOf<"s3">;
    return endpoint === "" ? null : endpoint;
  }
  if (provider === "webdav") {
    return (credentials as CredentialsOf<"webdav">).url;
  }
  return null;
}

/**
 * Opens a destination: checks it may be used, mints whatever token it needs,
 * and returns something that can write files.
 *
 * Everything that can refuse does so here, before a byte of the person's data
 * has been read.
 */
export async function openTransport(
  provider: BackupProvider,
  credentials: unknown,
  options: OpenOptions = {},
): Promise<BackupTransport> {
  const env = getEnv();

  const availability = providerAvailability(provider);
  if (availability !== "available") {
    throw new BackupError(
      "unavailable",
      availability === "experimental_off"
        ? "This server has not switched on experimental providers."
        : availability === "not_offered"
          ? "That provider is not offered yet."
          : "That provider is not available.",
    );
  }

  const parsed = credentialSchemas[provider].safeParse(credentials);
  if (!parsed.success) {
    throw new BackupError(
      "reconnect",
      "The saved details are no longer valid.",
    );
  }

  const endpoint = endpointOf(provider, parsed.data);
  if (endpoint) {
    await assertEndpointAllowed(endpoint, {
      allowPrivate: env.BACKUP_ALLOW_PRIVATE_ENDPOINTS,
    });
  }

  const now = options.now ?? (() => new Date());
  let app: { clientId: string; clientSecret: string } | undefined;
  let token: OAuthToken | undefined;
  let mint: (() => Promise<void>) | undefined;
  if (PROVIDERS[provider].kind === "oauth") {
    const kind = KIND_OF[provider as keyof typeof KIND_OF];
    const sealed = parsed.data as {
      refreshToken: string;
      app?: { clientId: string; clientSecret: string };
    };
    // The app the connection was made through, because a refresh token only
    // works for the client it was issued to. A connection made through the
    // operator's app carries none and uses whatever the operator has now.
    const resolved = resolveApp(kind, sealed.app);
    if (!resolved) {
      throw new BackupError(
        "app",
        "This connection has no app to sign in through.",
      );
    }
    app = resolved;
    mint = async () => {
      // The newest refresh token this transport holds: after a rotation, the
      // one it was opened with may already be spent.
      const stored = token?.refreshToken ?? sealed.refreshToken;
      const fresh = await refreshAccessToken(kind, stored, now(), resolved);
      const refreshToken = fresh.refreshToken ?? stored;
      if (refreshToken !== stored) await options.onRefreshToken?.(refreshToken);
      token = {
        accessToken: fresh.accessToken,
        refreshToken,
        expiresAt: fresh.expiresAt,
      };
    };
    await mint();
  }

  const build = () =>
    buildRemote(provider, parsed.data, {
      obscure: rclone.obscure,
      oauthApp: app,
      token,
    });
  let remote = await build();

  // One refresh at a time, however many calls find the token low together.
  let refreshing: Promise<void> | undefined;
  const current = async (): Promise<RcloneRemote> => {
    const refresh = mint;
    if (
      refresh &&
      token &&
      token.expiresAt.getTime() - now().getTime() < TOKEN_MARGIN_MS
    ) {
      refreshing ??= (async () => {
        try {
          await refresh();
          remote = await build();
        } finally {
          refreshing = undefined;
        }
      })();
      await refreshing;
    }
    return remote;
  };

  return {
    check: async () => rclone.checkConnection(await current()),
    ensureDirectory: async (folder) =>
      rclone.ensureDirectory(inFolder(await current(), folder)),
    put: async (name, bytes, folder) =>
      rclone.putObject(inFolder(await current(), folder), name, bytes),
    list: async (folder) =>
      rclone.listObjects(inFolder(await current(), folder)),
    remove: async (name, folder) =>
      rclone.deleteObject(inFolder(await current(), folder), name),
    read: async (name, folder) =>
      rclone.readObject(inFolder(await current(), folder), name),
  };
}
