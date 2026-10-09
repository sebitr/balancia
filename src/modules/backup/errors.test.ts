import { describe, expect, it } from "vitest";
import { classify, needsPerson, scrub } from "./errors";

/**
 * What the scheduler does next depends on which of these a failure lands in,
 * so the cases are the messages providers really send — the ones that matter
 * most are the pairs that look alike and mean different things.
 */

describe("classify", () => {
  it.each([
    [
      "Google Drive revoked access",
      'Failed to create file system for "BACKUP:": couldn\'t fetch token: invalid_grant: Token has been expired or revoked.',
      "reconnect",
    ],
    [
      "Dropbox token revoked",
      "Failed to rcat: path/get_metadata/...: expired_access_token/",
      "reconnect",
    ],
    [
      "S3 wrong key",
      "Failed to rcat: InvalidAccessKeyId: The AWS Access Key Id you provided does not exist in our records.",
      "reconnect",
    ],
    [
      "S3 wrong secret",
      "SignatureDoesNotMatch: The request signature we calculated does not match",
      "reconnect",
    ],
    ["WebDAV wrong password", "Failed to rcat: 401 Unauthorized", "reconnect"],
    [
      "iCloud needs a new code",
      "Failed to create file system: trust token expired, please reauthenticate with 2FA",
      "reconnect",
    ],
    [
      "Google does not know the app",
      'Failed to create file system for "BACKUP:": couldn\'t fetch token: invalid_client: The OAuth client was not found.',
      "app",
    ],
    [
      "Microsoft says the client secret expired",
      "AADSTS7000222: The provided client secret keys for app are expired.",
      "app",
    ],
    [
      "Microsoft cannot find the application",
      "AADSTS700016: Application with identifier was not found in the directory.",
      "app",
    ],
    [
      "Drive full",
      "googleapi: Error 403: The user's Drive storage quota has been exceeded., storageQuotaExceeded",
      "quota",
    ],
    ["Nextcloud full", "Failed to rcat: 507 Insufficient Storage", "quota"],
    ["S3 policy", "AccessDenied: Access Denied (403)", "forbidden"],
    [
      "bucket missing",
      "NoSuchBucket: The specified bucket does not exist",
      "not_found",
    ],
    [
      "no route",
      'Get "https://nas.example.com/dav": dial tcp: lookup nas.example.com: no such host',
      "unreachable",
    ],
    [
      "slow server",
      "context deadline exceeded (Client.Timeout exceeded)",
      "unreachable",
    ],
    ["throttled", "SlowDown: Please reduce your request rate.", "rate_limited"],
    ["429", "googleapi: Error 429: Rate Limit Exceeded", "rate_limited"],
    ["nothing useful", "something went sideways", "unknown"],
  ] as const)("reads %s", (_name, stderr, expected) => {
    expect(classify(stderr)).toBe(expected);
  });

  it("calls a full account full even though Google says 403", () => {
    // 403 is "forbidden" everywhere else, and telling someone to fix a
    // permission when their drive is full sends them to the wrong settings.
    expect(classify("googleapi: Error 403: storageQuotaExceeded")).toBe(
      "quota",
    );
  });

  it("does not mistake a word for the end of the stream", () => {
    expect(classify("the thereof clause was rejected")).toBe("unknown");
  });
});

describe("needsPerson", () => {
  it("stops retrying only where a retry cannot work", () => {
    expect(needsPerson("reconnect")).toBe(true);
    // A refused app is refused again an hour later, and flags the account.
    expect(needsPerson("app")).toBe(true);
    expect(needsPerson("no_key")).toBe(true);
    expect(needsPerson("unreachable")).toBe(false);
    expect(needsPerson("quota")).toBe(false);
    expect(needsPerson("rate_limited")).toBe(false);
  });
});

describe("scrub", () => {
  it("removes a secret it was told about, wherever it appears", () => {
    const out = scrub("login failed for hunter2-secret at hunter2-secret", [
      "hunter2-secret",
    ]);

    expect(out).not.toContain("hunter2");
    expect(out).toContain("•••");
  });

  it("removes things that look like credentials even when it was not told", () => {
    const out = scrub(
      "GET https://user:pa55word@host/x?sig=abcdefghijklmnopqrstuvwxyz failed; Bearer eyJhbGciOi.abc.def; access_token=ya29.secretvalue",
    );

    expect(out).not.toContain("pa55word");
    expect(out).not.toContain("abcdefghijklmnopqrstuvwxyz");
    expect(out).not.toContain("eyJhbGciOi");
    expect(out).not.toContain("ya29.secretvalue");
  });

  it("ignores a 'secret' short enough to be a word", () => {
    expect(scrub("the key was wrong", ["key"])).toBe("the key was wrong");
  });

  it("keeps the end of a long output, where rclone says what happened", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    const out = scrub(lines.join("\n"));

    expect(out).toContain("line 29");
    expect(out).not.toContain("line 3 ");
  });

  it("cuts to a length a table cell can hold", () => {
    expect(scrub("x".repeat(5000)).length).toBeLessThanOrEqual(400);
  });

  it("strips terminal colour codes", () => {
    expect(scrub("\u001b[31mERROR\u001b[0m: boom")).toBe("ERROR: boom");
  });
});
