import {
  BACKUP_FOLDER,
  type BackupProvider,
  type CredentialsOf,
} from "./providers";

/**
 * From a destination's sealed details to the settings rclone is run with.
 *
 * ## Environment, not a file
 *
 * rclone can read a remote's entire configuration from `RCLONE_CONFIG_<NAME>_*`
 * variables, so nothing here is ever written to disk: the secrets travel from
 * the database to the child process's environment and no further. The process
 * is also given nothing else — see `rclone.ts` — so it never sees
 * `AUTH_SECRET` or the database URL that its parent holds.
 *
 * ## The only file that names an rclone option
 *
 * Everything that reaches rclone passes through this function and is built
 * from fixed keys. No user-supplied string is ever an option *name*, and the
 * values are validated by `providers.ts` first, so a person cannot turn "my
 * bucket" into `--config` or point a remote at `local`, `alias` or `crypt`.
 */

/** The name the one remote goes by. Arbitrary; it appears in `BACKUP:path`. */
export const REMOTE = "BACKUP";

/** An OAuth app's registration: the owner's own, or the one the operator configured. */
export interface OAuthApp {
  readonly clientId: string;
  readonly clientSecret: string;
}

/** A short-lived access token Balancia minted, with its refresh token. */
export interface OAuthToken {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}

export interface BuildContext {
  /**
   * rclone's reversible "obscuring" of a password, which its backends insist
   * on seeing in place of the password itself. It is not encryption and adds
   * no secrecy; it is how the format is spelled. Injected so that this file
   * stays free of process spawning and can be tested without rclone.
   */
  readonly obscure: (value: string) => Promise<string>;
  /** The app the connection was made through, for the three OAuth providers. */
  readonly oauthApp?: OAuthApp;
  /** A fresh token, for the three OAuth providers. */
  readonly token?: OAuthToken;
}

export interface RcloneRemote {
  /** `RCLONE_CONFIG_BACKUP_*` variables. Contains secrets: never log it. */
  readonly env: Readonly<Record<string, string>>;
  /** The directory inside the remote that holds the backups, without the remote's name. */
  readonly directory: string;
}

/**
 * The folders inside the backup folder. A list rather than a string: a name
 * that reaches rclone's path is one of these, never something derived from
 * input.
 */
export const BACKUP_SUBFOLDERS = ["receipts"] as const;
export type BackupSubfolder = (typeof BACKUP_SUBFOLDERS)[number];

/** The same remote, aimed at one of the folders inside the backup folder. */
export function inFolder(
  remote: RcloneRemote,
  folder: BackupSubfolder | undefined,
): RcloneRemote {
  if (folder === undefined) return remote;
  if (!(BACKUP_SUBFOLDERS as readonly string[]).includes(folder)) {
    throw new Error(`Unknown backup folder ${String(folder)}.`);
  }
  return { env: remote.env, directory: `${remote.directory}/${folder}` };
}

const PREFIX = `RCLONE_CONFIG_${REMOTE}_`;

function join(...segments: readonly string[]): string {
  return segments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment !== "")
    .join("/");
}

function tokenJson(token: OAuthToken): string {
  return JSON.stringify({
    access_token: token.accessToken,
    token_type: "Bearer",
    refresh_token: token.refreshToken,
    expiry: token.expiresAt.toISOString(),
  });
}

function requireOAuth(context: BuildContext): {
  app: OAuthApp;
  token: OAuthToken;
} {
  if (!context.oauthApp || !context.token) {
    throw new Error("An OAuth provider needs an app and a token.");
  }
  return { app: context.oauthApp, token: context.token };
}

export async function buildRemote(
  provider: BackupProvider,
  credentials: unknown,
  context: BuildContext,
): Promise<RcloneRemote> {
  const options: Record<string, string> = {};
  const set = (name: string, value: string | undefined) => {
    if (value === undefined || value === "") return;
    options[`${PREFIX}${name.toUpperCase()}`] = value;
  };
  let directory = BACKUP_FOLDER;

  switch (provider) {
    case "s3": {
      const c = credentials as CredentialsOf<"s3">;
      set("type", "s3");
      set("provider", c.flavour);
      set("access_key_id", c.accessKeyId);
      set("secret_access_key", c.secretAccessKey);
      set("endpoint", c.endpoint);
      set("region", c.region);
      set("env_auth", "false");
      set(
        "force_path_style",
        c.pathStyle || c.flavour === "Minio" ? "true" : "false",
      );
      // The bucket is the person's to have made. Creating one would need a
      // permission a write-only key rightly lacks, and a typo would quietly
      // make a new bucket in the wrong place rather than fail.
      set("no_check_bucket", "true");
      directory = join(c.bucket, c.prefix, BACKUP_FOLDER);
      break;
    }
    case "webdav": {
      const c = credentials as CredentialsOf<"webdav">;
      set("type", "webdav");
      set("url", c.url);
      set("vendor", c.vendor);
      set("user", c.username);
      set("pass", await context.obscure(c.password));
      directory = join(c.folder, BACKUP_FOLDER);
      break;
    }
    case "google_drive": {
      const { app, token } = requireOAuth(context);
      set("type", "drive");
      set("client_id", app.clientId);
      set("client_secret", app.clientSecret);
      // Files this app made, and no others. Balancia can neither read the
      // person's documents nor list them.
      set("scope", "drive.file");
      set("token", tokenJson(token));
      // Retention deletes our own old backups; leave them in the trash and
      // they go on counting against the person's quota for another month.
      set("use_trash", "false");
      break;
    }
    case "dropbox": {
      const { app, token } = requireOAuth(context);
      set("type", "dropbox");
      set("client_id", app.clientId);
      set("client_secret", app.clientSecret);
      set("token", tokenJson(token));
      break;
    }
    case "onedrive": {
      const c = credentials as CredentialsOf<"onedrive">;
      const { app, token } = requireOAuth(context);
      set("type", "onedrive");
      set("client_id", app.clientId);
      set("client_secret", app.clientSecret);
      set("token", tokenJson(token));
      set("drive_id", c.driveId);
      set("drive_type", c.driveType);
      // The app folder, by id. Microsoft's narrow scope cannot see the rest of
      // the drive, and rclone would otherwise start from the drive's root.
      set("root_folder_id", c.rootFolderId);
      break;
    }
    case "proton_drive": {
      const c = credentials as CredentialsOf<"proton_drive">;
      set("type", "protondrive");
      set("username", c.username);
      set("password", await context.obscure(c.password));
      if (c.mailboxPassword) {
        set("mailbox_password", await context.obscure(c.mailboxPassword));
      }
      if (c.otpSecret) {
        set("otp_secret_key", await context.obscure(c.otpSecret));
      }
      break;
    }
    case "icloud_drive": {
      const c = credentials as CredentialsOf<"icloud_drive">;
      set("type", "iclouddrive");
      set("apple_id", c.appleId);
      set("password", await context.obscure(c.password));
      set("trust_token", c.trustToken);
      set("cookies", c.cookies);
      break;
    }
  }

  for (const [key, value] of Object.entries(options)) {
    if (value.includes("\0")) {
      throw new Error(`${key} contains a NUL byte.`);
    }
  }
  return { env: options, directory };
}
