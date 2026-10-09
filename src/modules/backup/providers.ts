import { z } from "zod";

/**
 * The places a backup can be written, and what each one needs to be told.
 *
 * Two kinds, and the split decides how a screen behaves:
 *
 *  - **`oauth`** providers (Google Drive, Dropbox, OneDrive) are connected by
 *    sending the person to the provider and back, and what Balancia keeps is a
 *    refresh token. They need an *app* registered with the provider (a client
 *    ID and secret), and whose it is is the owner's choice: they register
 *    their own and paste it in, so nobody else's quota, review or revocation
 *    stands between them and their own Drive; or, where the operator of this
 *    instance has registered one for everybody (`BACKUP_*_CLIENT_ID`), they
 *    press one button. Either way the tokens are theirs and belong to their
 *    destination, and the app they used is sealed beside the token so a run
 *    keeps using the app the connection was made through.
 *  - **`credentials`** providers are connected with details the person types:
 *    a server address and a key, a username and a password. Nothing to
 *    register; they work on any instance.
 *
 * The transport underneath is rclone for every one of them. This file never
 * names an rclone option: `rclone-config.ts` is the only place that does, and
 * a credential shape is validated here, once, before it is sealed — so that
 * nothing a person types can become an rclone flag.
 */

export const BACKUP_PROVIDERS = [
  "google_drive",
  "dropbox",
  "onedrive",
  "s3",
  "webdav",
  "proton_drive",
  "icloud_drive",
] as const;

export type BackupProvider = (typeof BACKUP_PROVIDERS)[number];

export type ProviderKind = "oauth" | "credentials";

export interface ProviderInfo {
  readonly id: BackupProvider;
  readonly kind: ProviderKind;
  /**
   * Works, but through an interface the provider does not publish or support
   * for this, and with the account's password held on the server. Shown apart,
   * with a caution, and switched off unless the operator turns it on
   * (`BACKUP_EXPERIMENTAL_PROVIDERS`).
   */
  readonly experimental: boolean;
  /**
   * Whether anything offers it. The credential shape and the rclone mapping for
   * iCloud Drive are here, but signing in to it takes an interactive two-factor
   * handshake that nothing in this repository can complete or test without an
   * Apple account, so no screen offers it and `openTransport` refuses it. The
   * reasoning is in `docs/cloud-backup.md`.
   */
  readonly offered: boolean;
}

export const PROVIDERS: Readonly<Record<BackupProvider, ProviderInfo>> = {
  google_drive: {
    id: "google_drive",
    kind: "oauth",
    experimental: false,
    offered: true,
  },
  dropbox: { id: "dropbox", kind: "oauth", experimental: false, offered: true },
  onedrive: {
    id: "onedrive",
    kind: "oauth",
    experimental: false,
    offered: true,
  },
  s3: { id: "s3", kind: "credentials", experimental: false, offered: true },
  webdav: {
    id: "webdav",
    kind: "credentials",
    experimental: false,
    offered: true,
  },
  proton_drive: {
    id: "proton_drive",
    kind: "credentials",
    experimental: true,
    offered: true,
  },
  icloud_drive: {
    id: "icloud_drive",
    kind: "credentials",
    experimental: true,
    offered: false,
  },
};

export function isBackupProvider(value: string): value is BackupProvider {
  return (BACKUP_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Brand names, which are not translated. Used to build the label a person
 * sees on a destination, and stored with it so that a provider renamed later
 * does not rewrite what a person already has.
 */
export const PROVIDER_NAMES: Readonly<Record<BackupProvider, string>> = {
  google_drive: "Google Drive",
  dropbox: "Dropbox",
  onedrive: "OneDrive",
  s3: "S3",
  webdav: "WebDAV",
  proton_drive: "Proton Drive",
  icloud_drive: "iCloud Drive",
};

/** Folder, at the destination, that every backup goes into. */
export const BACKUP_FOLDER = "Balancia Backups";

/**
 * The S3-compatible services a form names, each with the one rclone needs to
 * know — how that service differs from AWS — and the shape of the address to
 * hint at.
 *
 * Hints, not defaults. A guessed endpoint that is one datacentre out is worse
 * than an empty field, because the error it gives ("no such host", "wrong
 * region") sounds like the person's mistake. Infomaniak's Swiss Backup, for
 * one, hands out the address per backup slot, and it is the dashboard's to name.
 */
export const S3_PRESETS = {
  aws: { flavour: "AWS", endpointHint: "", regionHint: "eu-central-1" },
  backblaze: {
    flavour: "Other",
    endpointHint: "s3.<region>.backblazeb2.com",
    regionHint: "eu-central-003",
  },
  wasabi: {
    flavour: "Wasabi",
    endpointHint: "s3.<region>.wasabisys.com",
    regionHint: "eu-central-1",
  },
  cloudflare: {
    flavour: "Cloudflare",
    endpointHint: "<account>.r2.cloudflarestorage.com",
    regionHint: "auto",
  },
  infomaniak: { flavour: "Other", endpointHint: "", regionHint: "" },
  minio: { flavour: "Minio", endpointHint: "", regionHint: "" },
  other: { flavour: "Other", endpointHint: "", regionHint: "" },
} as const;

export type S3Preset = keyof typeof S3_PRESETS;
const S3_FLAVOURS = ["AWS", "Other", "Wasabi", "Cloudflare", "Minio"] as const;

export const WEBDAV_VENDORS = ["nextcloud", "owncloud", "other"] as const;

/** A bucket or folder name as a person types it; rclone gets it as a path, so no `..`. */
const pathSegment = z
  .string()
  .trim()
  .max(200)
  .refine((value) => !value.split("/").includes(".."), "no parent folders")
  .refine(
    (value) => !value.includes("\\") && !/[\u0000-\u001f]/.test(value),
    "not a path",
  );

const httpUrl = z
  .string()
  .trim()
  .max(500)
  .url()
  .refine((value) => /^https?:\/\//i.test(value), "must be http(s)")
  .refine((value) => {
    try {
      const url = new URL(value);
      // A password in the address would end up in logs and in rclone's
      // arguments; there are fields for those.
      return url.username === "" && url.password === "";
    } catch {
      return false;
    }
  }, "no credentials in the address");

/**
 * An app the owner registered with the provider, as they paste it.
 *
 * Values go to the provider's token endpoint and into rclone's environment, so
 * they are held to what those places can carry: no whitespace inside, no
 * control characters, no NUL. The lengths are generous (a Google secret is 35
 * characters, a Microsoft one about 40, a client ID under 100), not exact —
 * the provider is the judge of whether it is real.
 */
const appValue = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/[\s\u0000-\u001f\u007f]/.test(value), "no spaces");

export const oauthAppSchema = z.object({
  clientId: appValue(300),
  clientSecret: appValue(600),
});

export type OwnOAuthApp = z.infer<typeof oauthAppSchema>;

/** What is sealed for each provider. Tokens are minted by the OAuth callback, not typed. */
export const credentialSchemas = {
  google_drive: z.object({
    refreshToken: z.string().min(1),
    account: z.string().max(320).optional(),
    /** The owner's own app. Absent means the one the operator registered. */
    app: oauthAppSchema.optional(),
  }),
  dropbox: z.object({
    refreshToken: z.string().min(1),
    account: z.string().max(320).optional(),
    app: oauthAppSchema.optional(),
  }),
  onedrive: z.object({
    refreshToken: z.string().min(1),
    account: z.string().max(320).optional(),
    app: oauthAppSchema.optional(),
    driveId: z.string().min(1).max(200),
    driveType: z.enum(["personal", "business", "documentLibrary"]),
    /** The app folder's item id: the one place the narrow scope can write. */
    rootFolderId: z.string().min(1).max(200),
  }),
  s3: z.object({
    /** Empty means AWS itself. */
    endpoint: z.union([z.literal(""), httpUrl]),
    region: z.string().trim().max(60),
    flavour: z.enum(S3_FLAVOURS),
    bucket: z
      .string()
      .trim()
      .min(3)
      .max(63)
      .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/, "not a bucket name"),
    /** Optional folder inside the bucket. */
    prefix: pathSegment.default(""),
    accessKeyId: z.string().trim().min(1).max(200),
    secretAccessKey: z.string().min(1).max(500),
    pathStyle: z.boolean().default(false),
  }),
  webdav: z.object({
    url: httpUrl,
    vendor: z.enum(WEBDAV_VENDORS).default("other"),
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(500),
    /** Folder under the URL that backups go into. */
    folder: pathSegment.default(""),
  }),
  proton_drive: z.object({
    username: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(500),
    /** Only for accounts with a separate mailbox password. */
    mailboxPassword: z.string().max(500).optional(),
    /** The authenticator's secret key (not a six-digit code, which expires in seconds). */
    otpSecret: z.string().trim().max(200).optional(),
  }),
  icloud_drive: z.object({
    appleId: z.string().trim().min(1).max(320),
    password: z.string().min(1).max(500),
    /** Minted by signing in with a code; good for about thirty days. */
    trustToken: z.string().max(4000).optional(),
    cookies: z.string().max(8000).optional(),
  }),
} as const satisfies Record<BackupProvider, z.ZodType>;

export type Credentials<P extends BackupProvider = BackupProvider> = {
  [K in BackupProvider]: z.infer<(typeof credentialSchemas)[K]>;
}[P];

export type CredentialsOf<P extends BackupProvider> = z.infer<
  (typeof credentialSchemas)[P]
>;

/** The part of a destination's settings that is safe to show: never a secret. */
export function describeEndpoint(
  provider: BackupProvider,
  credentials: Credentials,
): string {
  switch (provider) {
    case "s3": {
      const c = credentials as CredentialsOf<"s3">;
      return c.endpoint ? `${new URL(c.endpoint).host}/${c.bucket}` : c.bucket;
    }
    case "webdav": {
      const c = credentials as CredentialsOf<"webdav">;
      return new URL(c.url).host;
    }
    default:
      return "";
  }
}
