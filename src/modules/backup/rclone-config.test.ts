import { describe, expect, it } from "vitest";
import { buildRemote, type BuildContext } from "./rclone-config";
import { credentialSchemas } from "./providers";

/**
 * Everything that reaches rclone passes through `buildRemote`, so these tests
 * are about what it must never do as much as what it does: let a typed value
 * become an option, leave a password readable, or step outside the folder it
 * was given.
 */

const context: BuildContext = {
  obscure: async (value) => `OBSCURED(${value.length})`,
  oauthApp: { clientId: "app-id", clientSecret: "app-secret" },
  token: {
    accessToken: "access-abc",
    refreshToken: "refresh-xyz",
    expiresAt: new Date("2026-10-09T04:30:00Z"),
  },
};

const s3 = credentialSchemas.s3.parse({
  endpoint: "https://s3.eu-central-003.backblazeb2.com",
  region: "eu-central-003",
  flavour: "Other",
  bucket: "family-backups",
  prefix: "ada",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "very-secret-key",
});

describe("S3", () => {
  it("describes the remote with fixed option names", async () => {
    const { env, directory } = await buildRemote("s3", s3, context);

    expect(env).toMatchObject({
      RCLONE_CONFIG_BACKUP_TYPE: "s3",
      RCLONE_CONFIG_BACKUP_PROVIDER: "Other",
      RCLONE_CONFIG_BACKUP_ACCESS_KEY_ID: "AKIAEXAMPLE",
      RCLONE_CONFIG_BACKUP_SECRET_ACCESS_KEY: "very-secret-key",
      RCLONE_CONFIG_BACKUP_ENDPOINT:
        "https://s3.eu-central-003.backblazeb2.com",
      RCLONE_CONFIG_BACKUP_ENV_AUTH: "false",
      RCLONE_CONFIG_BACKUP_NO_CHECK_BUCKET: "true",
    });
    expect(directory).toBe("family-backups/ada/Balancia Backups");
  });

  it("never reads the environment of the server for credentials", async () => {
    const { env } = await buildRemote("s3", s3, context);

    expect(env.RCLONE_CONFIG_BACKUP_ENV_AUTH).toBe("false");
  });

  it("uses path-style addressing for MinIO", async () => {
    const { env } = await buildRemote(
      "s3",
      { ...s3, flavour: "Minio", pathStyle: false },
      context,
    );

    expect(env.RCLONE_CONFIG_BACKUP_FORCE_PATH_STYLE).toBe("true");
  });

  it("leaves out what was left empty, so AWS is the default", async () => {
    const { env } = await buildRemote(
      "s3",
      { ...s3, endpoint: "", region: "" },
      context,
    );

    expect(env).not.toHaveProperty("RCLONE_CONFIG_BACKUP_ENDPOINT");
    expect(env).not.toHaveProperty("RCLONE_CONFIG_BACKUP_REGION");
  });

  it("does not let a prefix climb out of the bucket", () => {
    expect(
      credentialSchemas.s3.safeParse({ ...s3, prefix: "../other-bucket" })
        .success,
    ).toBe(false);
    expect(
      credentialSchemas.s3.safeParse({ ...s3, prefix: "a/../../b" }).success,
    ).toBe(false);
  });
});

describe("WebDAV", () => {
  const webdav = credentialSchemas.webdav.parse({
    url: "https://cloud.example.com/remote.php/dav/files/ada",
    vendor: "nextcloud",
    username: "ada",
    password: "hunter2-hunter2",
    folder: "Backups",
  });

  it("hands rclone the obscured password and never the plain one", async () => {
    const { env } = await buildRemote("webdav", webdav, context);

    expect(env.RCLONE_CONFIG_BACKUP_PASS).toBe("OBSCURED(15)");
    expect(JSON.stringify(env)).not.toContain("hunter2-hunter2");
  });

  it("puts the backups in a folder of their own under the one chosen", async () => {
    const { directory } = await buildRemote("webdav", webdav, context);

    expect(directory).toBe("Backups/Balancia Backups");
  });

  it("refuses an address with a password in it", () => {
    expect(
      credentialSchemas.webdav.safeParse({
        ...webdav,
        url: "https://ada:hunter2@cloud.example.com/dav",
      }).success,
    ).toBe(false);
  });

  it("refuses an address that is not web", () => {
    for (const url of [
      "file:///etc/passwd",
      "ftp://example.com",
      "javascript:1",
    ]) {
      expect(
        credentialSchemas.webdav.safeParse({ ...webdav, url }).success,
      ).toBe(false);
    }
  });
});

describe("OAuth providers", () => {
  it("asks Google for the narrow scope, and keeps deleted backups out of the trash", async () => {
    const { env, directory } = await buildRemote(
      "google_drive",
      { refreshToken: "r" },
      context,
    );

    expect(env.RCLONE_CONFIG_BACKUP_TYPE).toBe("drive");
    expect(env.RCLONE_CONFIG_BACKUP_SCOPE).toBe("drive.file");
    expect(env.RCLONE_CONFIG_BACKUP_USE_TRASH).toBe("false");
    expect(directory).toBe("Balancia Backups");
  });

  it("hands over a token that is fresh, with the moment it stops being so", async () => {
    const { env } = await buildRemote(
      "dropbox",
      { refreshToken: "r" },
      context,
    );

    expect(JSON.parse(env.RCLONE_CONFIG_BACKUP_TOKEN ?? "")).toEqual({
      access_token: "access-abc",
      token_type: "Bearer",
      refresh_token: "refresh-xyz",
      expiry: "2026-10-09T04:30:00.000Z",
    });
  });

  it("points OneDrive at the app folder by id", async () => {
    const { env } = await buildRemote(
      "onedrive",
      {
        refreshToken: "r",
        driveId: "b!abc",
        driveType: "personal",
        rootFolderId: "FOLDER123",
      },
      context,
    );

    expect(env).toMatchObject({
      RCLONE_CONFIG_BACKUP_TYPE: "onedrive",
      RCLONE_CONFIG_BACKUP_DRIVE_ID: "b!abc",
      RCLONE_CONFIG_BACKUP_DRIVE_TYPE: "personal",
      RCLONE_CONFIG_BACKUP_ROOT_FOLDER_ID: "FOLDER123",
    });
  });

  it("refuses to build one without the operator's app or a token", async () => {
    await expect(
      buildRemote(
        "google_drive",
        { refreshToken: "r" },
        { obscure: context.obscure },
      ),
    ).rejects.toThrow(/operator/);
  });
});

describe("experimental providers", () => {
  it("obscures every password Proton Drive is given", async () => {
    const { env } = await buildRemote(
      "proton_drive",
      credentialSchemas.proton_drive.parse({
        username: "ada@proton.me",
        password: "pw-one-pw-one",
        mailboxPassword: "pw-two-pw-two",
        otpSecret: "JBSWY3DPEHPK3PXP",
      }),
      context,
    );

    expect(env.RCLONE_CONFIG_BACKUP_TYPE).toBe("protondrive");
    expect(JSON.stringify(env)).not.toContain("pw-one");
    expect(JSON.stringify(env)).not.toContain("pw-two");
    expect(JSON.stringify(env)).not.toContain("JBSWY3DPEHPK3PXP");
  });

  it("obscures the Apple ID password", async () => {
    const { env } = await buildRemote(
      "icloud_drive",
      credentialSchemas.icloud_drive.parse({
        appleId: "ada@icloud.com",
        password: "apple-password",
      }),
      context,
    );

    expect(env.RCLONE_CONFIG_BACKUP_TYPE).toBe("iclouddrive");
    expect(JSON.stringify(env)).not.toContain("apple-password");
  });
});

describe("whatever is typed", () => {
  it("refuses a line break in a folder name before it gets anywhere", () => {
    expect(
      credentialSchemas.s3.safeParse({
        ...s3,
        prefix: "x\nRCLONE_CONFIG_BACKUP_TYPE=local",
      }).success,
    ).toBe(false);
  });

  it("only ever produces variables of the one remote", async () => {
    // `=` and spaces are legal in a folder name and in a key, and must stay
    // values: nothing typed is ever an option name.
    const hostile = credentialSchemas.s3.parse({
      ...s3,
      bucket: "valid-bucket",
      prefix: "RCLONE_CONFIG_BACKUP_TYPE=local",
      accessKeyId: "a b=c",
    });

    const { env } = await buildRemote("s3", hostile, context);

    for (const key of Object.keys(env)) {
      expect(key).toMatch(/^RCLONE_CONFIG_BACKUP_[A-Z_]+$/);
    }
    expect(env.RCLONE_CONFIG_BACKUP_TYPE).toBe("s3");
  });

  it("refuses a NUL byte, which cannot live in an environment variable", async () => {
    await expect(
      buildRemote("s3", { ...s3, accessKeyId: "a\0b" }, context),
    ).rejects.toThrow(/NUL/);
  });
});
