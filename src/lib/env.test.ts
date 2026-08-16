import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLE_NAMES, EnvironmentError, parseEnv } from "./env";

const base = {
  DATABASE_URL: "postgres://balancia:secret@localhost:5432/balancia",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789",
};

describe("environment validation", () => {
  it("accepts a minimal localhost development configuration", () => {
    const env = parseEnv({ ...base } as unknown as NodeJS.ProcessEnv);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.webAuthnRpId).toBe("localhost");
    expect(env.trustedOrigins).toEqual(["http://localhost:3000"]);
    expect(env.smtpEnabled).toBe(false);
    expect(env.STORAGE_DRIVER).toBe("local");
  });

  it("requires a database URL", () => {
    expect(() =>
      parseEnv({
        AUTH_SECRET: base.AUTH_SECRET,
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(EnvironmentError);
  });

  it("rejects a short auth secret", () => {
    expect(() =>
      parseEnv({
        ...base,
        AUTH_SECRET: "too-short",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/AUTH_SECRET/);
  });

  it("rejects a non-PostgreSQL database URL", () => {
    expect(() =>
      parseEnv({
        ...base,
        DATABASE_URL: "mysql://localhost/balancia",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/PostgreSQL/);
  });

  describe("WebAuthn consistency", () => {
    it("defaults the relying-party ID to the APP_URL host", () => {
      const env = parseEnv({
        ...base,
        APP_URL: "https://balancia.example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.webAuthnRpId).toBe("balancia.example.com");
    });

    it("allows a registrable parent domain as relying-party ID", () => {
      const env = parseEnv({
        ...base,
        APP_URL: "https://balancia.example.com",
        WEBAUTHN_RP_ID: "example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.webAuthnRpId).toBe("example.com");
    });

    it("fails startup when the relying-party ID does not match the host", () => {
      expect(() =>
        parseEnv({
          ...base,
          APP_URL: "https://balancia.example.com",
          WEBAUTHN_RP_ID: "other.org",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/relying-party ID/);
    });

    it("fails startup for plain HTTP on a non-localhost host", () => {
      expect(() =>
        parseEnv({
          ...base,
          APP_URL: "http://balancia.example.com",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/HTTPS/);
    });

    it("permits plain HTTP on localhost for development", () => {
      for (const url of [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://app.localhost:3000",
      ]) {
        expect(() =>
          parseEnv({ ...base, APP_URL: url } as unknown as NodeJS.ProcessEnv),
        ).not.toThrow();
      }
    });
  });

  describe("storage", () => {
    it("requires bucket and region for the S3 driver", () => {
      expect(() =>
        parseEnv({
          ...base,
          STORAGE_DRIVER: "s3",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/S3_BUCKET/);
    });

    it("accepts a complete S3 configuration", () => {
      const env = parseEnv({
        ...base,
        STORAGE_DRIVER: "s3",
        S3_BUCKET: "receipts",
        S3_REGION: "eu-west-1",
        S3_FORCE_PATH_STYLE: "true",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.S3_BUCKET).toBe("receipts");
      expect(env.S3_FORCE_PATH_STYLE).toBe(true);
    });
  });

  describe("SMTP", () => {
    it("stays disabled when unconfigured", () => {
      expect(
        parseEnv({ ...base } as unknown as NodeJS.ProcessEnv).smtpEnabled,
      ).toBe(false);
    });

    it("treats an empty port as unset rather than zero", () => {
      // compose.yaml passes optional settings as `${SMTP_PORT:-}`, so an
      // instance with no mail configured supplies "" rather than omitting it.
      // Coercing that to 0 failed the range check and stopped the app booting.
      const env = parseEnv({
        ...base,
        SMTP_HOST: "",
        SMTP_PORT: "",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.SMTP_PORT).toBeUndefined();
      expect(env.smtpEnabled).toBe(false);
    });

    it("requires a From address when a host is set", () => {
      expect(() =>
        parseEnv({
          ...base,
          SMTP_HOST: "smtp.example.com",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/SMTP_FROM/);
    });

    it("enables mail when host and From are present", () => {
      const env = parseEnv({
        ...base,
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_FROM: "balancia@example.com",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.smtpEnabled).toBe(true);
      expect(env.SMTP_PORT).toBe(587);
    });
  });

  describe("Sign in with Apple", () => {
    const apple = {
      APP_URL: "https://balancia.example.com",
      APPLE_CLIENT_ID: "com.example.balancia.web",
      APPLE_TEAM_ID: "A1B2C3D4E5",
      APPLE_KEY_ID: "ABC1234567",
      APPLE_PRIVATE_KEY:
        "-----BEGIN PRIVATE KEY-----\nMIGH\n-----END PRIVATE KEY-----",
    };

    it("stays disabled when unconfigured", () => {
      expect(
        parseEnv({ ...base } as unknown as NodeJS.ProcessEnv)
          .appleSignInEnabled,
      ).toBe(false);
    });

    it("enables it when all four values are present", () => {
      const env = parseEnv({
        ...base,
        ...apple,
      } as unknown as NodeJS.ProcessEnv);
      expect(env.appleSignInEnabled).toBe(true);
    });

    it("names the missing half rather than half-working", () => {
      // Three of four fails at the redirect, where the error is Apple's and
      // says nothing useful. It should fail at boot instead.
      expect(() =>
        parseEnv({
          ...base,
          ...apple,
          APPLE_KEY_ID: "",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/APPLE_KEY_ID is required/);
    });

    it("unescapes the newlines a .env file cannot carry", () => {
      const env = parseEnv({
        ...base,
        ...apple,
        APPLE_PRIVATE_KEY:
          "-----BEGIN PRIVATE KEY-----\\nMIGH\\n-----END PRIVATE KEY-----",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.APPLE_PRIVATE_KEY).toBe(
        "-----BEGIN PRIVATE KEY-----\nMIGH\n-----END PRIVATE KEY-----",
      );
    });

    it("rejects a key that is a path or an identifier rather than a key", () => {
      expect(() =>
        parseEnv({
          ...base,
          ...apple,
          APPLE_PRIVATE_KEY: "/run/secrets/AuthKey_ABC1234567.p8",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/BEGIN PRIVATE KEY/);
    });

    it("rejects identifiers that are not Apple's ten characters", () => {
      expect(() =>
        parseEnv({
          ...base,
          ...apple,
          APPLE_TEAM_ID: "A1B2C3",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/APPLE_TEAM_ID/);
    });

    it("refuses an origin Apple would never redirect to", () => {
      // Apple rejects http:// and localhost return URLs outright, so an
      // instance configured this way can never complete a sign-in.
      for (const APP_URL of [
        "http://balancia.example.com",
        "http://localhost:3000",
        "https://localhost:3000",
      ]) {
        expect(() =>
          parseEnv({
            ...base,
            ...apple,
            APP_URL,
          } as unknown as NodeJS.ProcessEnv),
        ).toThrow(/public HTTPS APP_URL/);
      }
    });

    it("leaves a plain localhost instance alone", () => {
      // The rule above must only bite when Apple is actually configured.
      expect(() =>
        parseEnv({ ...base } as unknown as NodeJS.ProcessEnv),
      ).not.toThrow();
    });
  });

  it("collects extra trusted origins", () => {
    const env = parseEnv({
      ...base,
      APP_URL: "https://balancia.example.com",
      TRUSTED_ORIGINS: "https://alt.example.com, https://other.example.com",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.trustedOrigins).toEqual([
      "https://balancia.example.com",
      "https://alt.example.com",
      "https://other.example.com",
    ]);
  });

  it("rejects placeholder secrets in production", () => {
    expect(() =>
      parseEnv({
        ...base,
        NODE_ENV: "production",
        APP_URL: "https://balancia.example.com",
        AUTH_SECRET: "change-me-change-me-change-me-change-me",
      } as unknown as NodeJS.ProcessEnv),
    ).toThrow(/placeholder/);
  });
});

/**
 * Settings that are deliberately not handed to the containers.
 *
 * Empty, and the intent is that it stays that way. A name added here is a
 * promise that an operator setting it in `.env` is *meant* to have no effect
 * under Compose — say why, next to the name.
 */
const NOT_FORWARDED = new Set<string>([]);

/**
 * The variables `compose.yaml` names for the app and worker containers.
 *
 * Read as text rather than parsed as YAML: the file is the contract here, and
 * a dependency-free regex over the one block that matters is enough to say
 * whether a name appears in it.
 */
function forwardedByCompose(): Set<string> {
  const source = readFileSync(path.join(process.cwd(), "compose.yaml"), "utf8");
  const start = source.indexOf("x-app-environment:");
  const end = source.indexOf("services:");
  expect(start, "compose.yaml should define x-app-environment").toBeGreaterThan(
    -1,
  );
  expect(end).toBeGreaterThan(start);

  const block = source.slice(start, end);
  return new Set(
    [...block.matchAll(/^ {2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]),
  );
}

describe("configuration reaches the containers", () => {
  /**
   * Compose passes only what it names. A setting the schema reads but
   * `compose.yaml` never mentions can be set in `.env`, survive a rebuild, and
   * still do nothing — which is how the exchange-rate provider shipped (#31)
   * and how push notifications shipped after it. This is that bug, as a test.
   */
  it("forwards every setting the app reads", () => {
    const forwarded = forwardedByCompose();

    const missing = ENV_VARIABLE_NAMES.filter(
      (name) => !forwarded.has(name) && !NOT_FORWARDED.has(name),
    );

    // The failure message is the fix: paste these lines into
    // x-app-environment and the test goes green.
    expect(
      missing,
      "compose.yaml does not pass these to the containers, so setting them " +
        "in .env does nothing. Add under x-app-environment:\n" +
        missing.map((name) => `  ${name}: \${${name}:-}`).join("\n"),
    ).toEqual([]);
  });

  it("names nothing the app does not read", () => {
    const known = new Set<string>(ENV_VARIABLE_NAMES);
    // Consumed by the entrypoint to assemble DATABASE_URL, not by the schema.
    known.add("POSTGRES_PASSWORD");

    const unknown = [...forwardedByCompose()].filter(
      (name) => !known.has(name),
    );

    expect(
      unknown,
      "compose.yaml forwards variables nothing reads; delete them or add them to the schema",
    ).toEqual([]);
  });
});

/**
 * The same text with its comments removed.
 *
 * Prose that mentions a setting is not code that acts on it, and the whole
 * point here is the difference. `SEMANTIC_CATEGORIZATION` and
 * `RECEIPT_SCANNING` each appear in two comments and a console message; had
 * the accessor calls that actually read them been deleted, the scan below
 * would have gone on passing on the strength of the comments alone — which is
 * the bug this file exists to catch, not to re-enact.
 *
 * `//` preceded by `:` is left alone so that a URL does not swallow the rest
 * of its line, and `#` only starts a comment in shell scripts.
 */
function stripComments(source: string, shell: boolean): string {
  const text = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
  return shell ? text.replace(/(^|\s)#.*$/gm, "$1") : text;
}

/**
 * Every file that could plausibly act on a setting: the app, and the scripts
 * that run around it. `env.ts` itself is excluded — declaring a variable is
 * what is being tested, not evidence of anything.
 */
function sourceMentioningEnv(): string {
  const roots = ["src", "scripts"];
  const declaration = path.join("src", "lib", "env.ts");
  const chunks: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx|mjs|js|sh)$/.test(entry.name)) {
        const relative = path.relative(process.cwd(), full);
        if (relative === declaration || relative.endsWith("env.test.ts")) {
          continue;
        }
        chunks.push(
          stripComments(readFileSync(full, "utf8"), entry.name.endsWith(".sh")),
        );
      }
    }
  };

  for (const root of roots) walk(path.join(process.cwd(), root));
  return chunks.join("\n");
}

/**
 * Settings the code consumes through a derived field rather than by name, and
 * the field each one feeds. The field still has to be used somewhere — a
 * setting read only by `buildEnv` and then dropped is a setting with no
 * effect, however thoroughly it was parsed.
 */
const READ_AS_DERIVED_FIELD: Readonly<Record<string, string>> = {
  WEBAUTHN_RP_ID: "webAuthnRpId",
  // Read through accessors rather than off the parsed object, so that
  // `proxy.ts` can ask on every request without the whole schema having to
  // parse cleanly. The accessor call is the evidence; the name itself now
  // survives only in prose.
  SEMANTIC_CATEGORIZATION: "isSemanticCategorizationEnabled",
  RECEIPT_SCANNING: "isReceiptScanningEnabled",
  // Same again: `proxy.ts` needs it per request to decide whether the CSP has
  // to allow WebAssembly, so it is read through an accessor rather than off
  // the parsed object.
  RECEIPT_OCR_LOCAL: "isLocalReceiptOcrEnabled",
};

/**
 * Known gaps: accepted, forwarded, documented, and acted on by nothing.
 *
 * Every name here is a bug waiting for someone to come back for it, not a
 * decision. Fixing one means deleting its line — and each fix is its own
 * branch, so this list is where they wait rather than being forgotten.
 */
const NOT_YET_READ = new Set<string>([
  // Derived into `trustedOrigins`, which no production code reads. Adding an
  // origin therefore does not trust it; the setting is inert.
  "TRUSTED_ORIGINS",
]);

describe("configuration reaches the code", () => {
  /**
   * Forwarding a setting is only half of it. `RUN_WORKER_IN_WEB` was in the
   * schema, in `x-app-environment`, and in two pages of documentation as the
   * switch that makes push delivery work on a single-container install — and
   * no code ever read it, so setting it started nothing and nothing was ever
   * pushed. Both tests above passed throughout. This is that bug, as a test.
   */
  it("reads every setting it accepts", () => {
    const source = sourceMentioningEnv();

    const unread = ENV_VARIABLE_NAMES.filter((name) => {
      if (NOT_YET_READ.has(name)) return false;
      const token = READ_AS_DERIVED_FIELD[name] ?? name;
      return !source.includes(token);
    });

    expect(
      unread,
      "these are accepted and forwarded but nothing acts on them, so an " +
        "operator can set them and watch nothing happen:\n" +
        unread.map((name) => `  ${name}`).join("\n"),
    ).toEqual([]);
  });

  it("keeps the known-gap list honest", () => {
    const source = sourceMentioningEnv();

    // A name that has since been wired up must leave this list, or the list
    // stops meaning anything.
    const nowRead = [...NOT_YET_READ].filter((name) => {
      const token = READ_AS_DERIVED_FIELD[name] ?? name;
      return source.includes(token);
    });

    expect(
      nowRead,
      "these are in NOT_YET_READ but something reads them now; delete their lines",
    ).toEqual([]);
  });
});
