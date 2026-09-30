import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ENV_VARIABLE_NAMES,
  EnvironmentError,
  isNewerSchemaAllowed,
  parseEnv,
} from "./env";

const base = {
  DATABASE_URL: "postgres://balancia:secret@localhost:5432/balancia",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef0123456789",
};

describe("environment validation", () => {
  it("accepts a minimal localhost development configuration", () => {
    const env = parseEnv({ ...base } as unknown as NodeJS.ProcessEnv);
    expect(env.APP_URL).toBe("http://localhost:3000");
    expect(env.webAuthnRpId).toBe("localhost");
    expect(env.smtpEnabled).toBe(false);
    expect(env.STORAGE_DRIVER).toBe("local");
  });

  /**
   * The whole reason the default stack is two containers. An instance that says
   * nothing about background jobs must run them, because the alternative — a
   * `.env` with no opinion and no worker service — is an app that serves every
   * page correctly and never generates a recurring expense, never delivers a
   * push and never prunes anything, with nothing in the log to say so.
   */
  it("runs the background jobs in the web process unless told otherwise", () => {
    const env = parseEnv({ ...base } as unknown as NodeJS.ProcessEnv);
    expect(env.RUN_WORKER_IN_WEB).toBe(true);
  });

  it("lets a deployment with a worker container turn that off", () => {
    const env = parseEnv({
      ...base,
      RUN_WORKER_IN_WEB: "false",
    } as unknown as NodeJS.ProcessEnv);
    expect(env.RUN_WORKER_IN_WEB).toBe(false);
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

  describe("exchange rates", () => {
    it("defaults to the v2 root", () => {
      const env = parseEnv({ ...base } as unknown as NodeJS.ProcessEnv);
      expect(env.EXCHANGE_RATE_API_URL).toBe("https://api.frankfurter.dev/v2");
    });

    it("refuses a v1 root, which prices thirty currencies and no more", () => {
      // v1 parses, resolves and answers 200. Nothing fails loudly — the
      // payload simply is not the one the provider reads, so every lookup
      // degrades to "no suggestion" with the reason buried in a log line.
      for (const EXCHANGE_RATE_API_URL of [
        "https://api.frankfurter.dev/v1",
        "https://api.frankfurter.dev/v1/",
        "https://rates.internal.example.com/v1",
      ]) {
        expect(() =>
          parseEnv({
            ...base,
            EXCHANGE_RATE_PROVIDER: "frankfurter",
            EXCHANGE_RATE_API_URL,
          } as unknown as NodeJS.ProcessEnv),
        ).toThrow(/EXCHANGE_RATE_API_URL/);
      }
    });

    it("leaves the URL alone when no provider is configured", () => {
      // The default is `none`, and a stale URL on an instance that makes no
      // outbound request at all is not worth refusing to boot over.
      expect(() =>
        parseEnv({
          ...base,
          EXCHANGE_RATE_API_URL: "https://api.frankfurter.dev/v1",
        } as unknown as NodeJS.ProcessEnv),
      ).not.toThrow();
    });

    it("accepts a v2 root on a path of its own", () => {
      const env = parseEnv({
        ...base,
        EXCHANGE_RATE_PROVIDER: "frankfurter",
        EXCHANGE_RATE_API_URL: "https://rates.internal.example.com/v2",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.EXCHANGE_RATE_API_URL).toBe(
        "https://rates.internal.example.com/v2",
      );
    });
  });

  describe("a database newer than this build", () => {
    const allowed = (source: Record<string, string>) =>
      isNewerSchemaAllowed(source as unknown as NodeJS.ProcessEnv);

    /**
     * The one place this is refused by default is where the data is real. A
     * development database is migrated by every branch in turn, and one that
     * is "ahead" of main is what stepping back from a branch looks like.
     */
    it("refuses in production and warns everywhere else, when unset", () => {
      expect(allowed({ NODE_ENV: "production" })).toBe(false);
      expect(allowed({ NODE_ENV: "development" })).toBe(true);
      expect(allowed({ NODE_ENV: "test" })).toBe(true);
      expect(allowed({})).toBe(true);
    });

    it("treats the empty string Compose passes as unset", () => {
      expect(allowed({ NODE_ENV: "production", ALLOW_NEWER_SCHEMA: "" })).toBe(
        false,
      );
      expect(
        allowed({ NODE_ENV: "development", ALLOW_NEWER_SCHEMA: " " }),
      ).toBe(true);
    });

    it("does what it is told when it is told", () => {
      for (const value of ["true", "1", "yes", "ON"]) {
        expect(
          allowed({ NODE_ENV: "production", ALLOW_NEWER_SCHEMA: value }),
        ).toBe(true);
      }
      expect(
        allowed({ NODE_ENV: "development", ALLOW_NEWER_SCHEMA: "false" }),
      ).toBe(false);
    });
  });

  /**
   * It was parsed, forwarded and documented as the way to admit a second front
   * door, and nothing read it. It cannot be made to mean that: a second host
   * that forwards its own `Host` already passes both origin checks untouched,
   * and the case that would need it — a proxy that rewrites `Host` — is
   * refused by Next's Server Action check, whose allow-list is compiled into
   * the standalone server at build time and out of reach of anything set at
   * runtime. So it is gone rather than half-honoured.
   */
  it("has no trusted-origins setting, and boots on an .env that still sets one", () => {
    expect(ENV_VARIABLE_NAMES).not.toContain("TRUSTED_ORIGINS");

    const env = parseEnv({
      ...base,
      APP_URL: "https://balancia.example.com",
      TRUSTED_ORIGINS: "https://alt.example.com",
    } as unknown as NodeJS.ProcessEnv);
    expect(env).not.toHaveProperty("TRUSTED_ORIGINS");
    expect(env).not.toHaveProperty("trustedOrigins");
  });

  describe("AUTH_SECRET in production", () => {
    const production = {
      ...base,
      NODE_ENV: "production",
      APP_URL: "https://balancia.example.com",
    };

    it("rejects placeholder secrets", () => {
      expect(() =>
        parseEnv({
          ...production,
          AUTH_SECRET: "change-me-change-me-change-me-change-me",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/placeholder/);
    });

    it("rejects a secret typed rather than generated", () => {
      for (const AUTH_SECRET of [
        "a".repeat(48),
        "ab".repeat(24),
        "1234".repeat(12),
      ]) {
        expect(() =>
          parseEnv({
            ...production,
            AUTH_SECRET,
          } as unknown as NodeJS.ProcessEnv),
        ).toThrow(/placeholder/);
      }
    });

    it("accepts what the generators hand out", () => {
      // bootstrap.sh's 64 alphanumerics, `openssl rand -base64 48`, and the
      // shortest of them all: `openssl rand -hex 16`, sixteen symbols over
      // thirty-two characters.
      for (const AUTH_SECRET of [
        "Qm7ZkT2rVx9bLp4NcW8sHd1YfG6jRa3EuK5oXi0qMn2tBv7yCz4wSe9gJh1lPd8u",
        "3q2+7wX9mK1pL0vB4nR8tY6uI5oP2aS7dF9gH3jK1lZ0xC4vB8nM6qW2eR5tY9uI",
        "9f86d081884c7d659a2feaa0c55ad015",
      ]) {
        expect(() =>
          parseEnv({
            ...production,
            AUTH_SECRET,
          } as unknown as NodeJS.ProcessEnv),
        ).not.toThrow();
      }
    });

    /**
     * Every secret the repository commits, and where. Each is at least 32
     * characters, so the length rule alone passed all of them.
     */
    const COMMITTED = [
      [
        "compose.dev.yaml",
        "dev-only-insecure-secret-0123456789abcdef0123456789abcdef",
      ],
      ["Dockerfile", "build-time-placeholder-not-used-at-runtime-0123456789"],
      [
        ".github/workflows/ci.yml",
        "ci-only-secret-0123456789abcdef0123456789abcdef",
      ],
      [
        "playwright.config.ts",
        "e2e-only-secret-0123456789abcdef0123456789abcdef",
      ],
      [
        "docs/environment.md",
        "dev-only-secret-0123456789abcdef0123456789abcdef",
      ],
      [
        "docs/development.md",
        "dev-only-secret-0123456789abcdef0123456789abcdef",
      ],
      [
        "src/lib/apple-app-site-association.test.ts",
        "test-secret-0123456789abcdef0123456789abcdef",
      ],
    ] as const;

    it("names secrets the repository really commits", () => {
      // The list above is only worth something while it is true. A value that
      // changes in its file changes here too, and the tests below then say
      // whether the new one is still refused.
      for (const [file, secret] of COMMITTED) {
        expect(
          readFileSync(path.join(process.cwd(), file), "utf8"),
          `${file} no longer contains ${secret}`,
        ).toContain(secret);
      }
    });

    it.each(COMMITTED)(
      "refuses the secret committed in %s on a public instance",
      (_file, AUTH_SECRET) => {
        expect(() =>
          parseEnv({
            ...production,
            AUTH_SECRET,
          } as unknown as NodeJS.ProcessEnv),
        ).toThrow(/committed to the Balancia repository/);
      },
    );

    it.each(COMMITTED)(
      "still runs the secret committed in %s on localhost",
      (_file, AUTH_SECRET) => {
        // CI's end-to-end job and Playwright serve a production build at
        // http://localhost:3100, and the Dockerfile builds with APP_URL at
        // http://localhost:3000. Refusing these there would refuse the suite
        // and the image, and protect nobody.
        for (const APP_URL of [
          "http://localhost:3000",
          "http://localhost:3100",
          "http://127.0.0.1:3000",
        ]) {
          expect(() =>
            parseEnv({
              ...production,
              APP_URL,
              AUTH_SECRET,
            } as unknown as NodeJS.ProcessEnv),
          ).not.toThrow();
        }
      },
    );
  });

  describe("telemetry", () => {
    it("permits an opt-in but enables nothing, on a bare configuration", () => {
      // The default is a ceiling, not a state: `opt-in` means an administrator
      // *may* switch reporting on, and until one does nothing is sent. The
      // half of the decision that is actually "on" lives in the database and
      // starts false; see src/lib/telemetry/settings.test.ts.
      const env = parseEnv({ ...base } as unknown as NodeJS.ProcessEnv);
      expect(env.TELEMETRY_MODE).toBe("opt-in");
      expect(env.TELEMETRY_RECEIVER).toBe(false);
      expect(env.METRICS_ENABLED).toBe(false);
      expect(env.METRICS_TOKEN).toBeUndefined();
    });

    it("accepts each mode and refuses anything else", () => {
      for (const TELEMETRY_MODE of ["opt-in", "local", "off"]) {
        expect(
          parseEnv({
            ...base,
            TELEMETRY_MODE,
          } as unknown as NodeJS.ProcessEnv).TELEMETRY_MODE,
        ).toBe(TELEMETRY_MODE);
      }

      expect(() =>
        parseEnv({
          ...base,
          TELEMETRY_MODE: "on",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/TELEMETRY_MODE/);
    });

    it("offers no way to say where reports go", () => {
      // The destination is a constant, not a setting: an address that could be
      // set here would make every claim in docs/telemetry.md conditional on
      // nobody having set it. `endpoint.test.ts` holds the constant itself.
      expect(ENV_VARIABLE_NAMES).not.toContain("TELEMETRY_ENDPOINT");

      const env = parseEnv({
        ...base,
        TELEMETRY_ENDPOINT: "https://collector.example.org",
      } as unknown as NodeJS.ProcessEnv);
      expect(env).not.toHaveProperty("TELEMETRY_ENDPOINT");
    });

    it("accepts an empty deployment label rather than failing to boot", () => {
      // compose.yaml passes optional settings as `${VAR:-}`, so an unset one
      // arrives as "" rather than as nothing.
      const env = parseEnv({
        ...base,
        TELEMETRY_DEPLOYMENT: "",
      } as unknown as NodeJS.ProcessEnv);
      expect(env.TELEMETRY_DEPLOYMENT).toBeUndefined();
    });

    it("refuses a deployment label it does not know", () => {
      expect(() =>
        parseEnv({
          ...base,
          TELEMETRY_DEPLOYMENT: "balancia.example.com",
        } as unknown as NodeJS.ProcessEnv),
      ).toThrow(/TELEMETRY_DEPLOYMENT/);
    });
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
 * What a Compose file publishes on an `.env` that says nothing: every entry
 * under a `ports:` key, with each `${VAR:-default}` replaced by its default.
 *
 * Text again, for the reason `forwardedByCompose` gives. The entries are
 * always written as one quoted string per line, which is all this reads.
 */
function defaultPublishedPorts(file: string): string[] {
  const source = readFileSync(path.join(process.cwd(), file), "utf8");
  return [...source.matchAll(/^\s*ports:\n((?:\s*(?:#.*|- ".*")\n)+)/gm)]
    .flatMap((block) => [...block[1].matchAll(/- "(.*)"/g)])
    .map((entry) => entry[1].replace(/\$\{[A-Z][A-Z0-9_]*:-([^}]*)\}/g, "$1"));
}

describe("published ports", () => {
  /**
   * Docker opens a published port with rules of its own, ahead of ufw, so an
   * entry that names no address is on the network whatever the host firewall
   * says. For the database that left the generated password as the one thing
   * in front of it. For the app it let a caller skip the reverse proxy and
   * write their own X-Forwarded-For, which every per-address rate limit then
   * believed.
   */
  it("keeps the production stack on this host unless told otherwise", () => {
    expect(defaultPublishedPorts("compose.yaml")).toEqual([
      "127.0.0.1:5458:5432",
      "127.0.0.1:3000:3000",
    ]);
  });

  it("keeps the demo on this host too — it sits behind a proxy as well", () => {
    expect(defaultPublishedPorts("compose.demo.yaml")).toEqual([
      "127.0.0.1:3001:3000",
    ]);
  });

  it("lets the published image inherit those ports rather than restate them", () => {
    // compose.image.yaml is an overlay: a `ports:` of its own would be merged
    // with compose.yaml's, and could only ever add an address.
    expect(defaultPublishedPorts("compose.image.yaml")).toEqual([]);
  });
});

/**
 * The wizard, read as text: the list it counts with, and the blocks it asks.
 *
 * Every question is written the same way — the guard that decides whether to
 * ask, and the heading on the line after it — so the two can be paired without
 * running the script.
 */
function bootstrapQuestions(): { counted: string[]; asked: string[] } {
  const source = readFileSync(
    path.join(process.cwd(), "scripts", "bootstrap.sh"),
    "utf8",
  );

  const list = /^question_keys='([^']*)'/m.exec(source);
  expect(list, "scripts/bootstrap.sh should define question_keys").not.toBe(
    null,
  );

  return {
    counted: list![1].split(/\s+/).filter(Boolean),
    asked: [
      ...source.matchAll(
        /if ! has_value ([A-Z][A-Z0-9_]*); then\n\s*question /g,
      ),
    ].map((match) => match[1]),
  };
}

describe("the setup wizard", () => {
  /**
   * `question_keys` exists only so the prompts can say "3 of 7", which means
   * it is the one part of a new question that nothing else needs — and so the
   * part that gets left behind. The symptom is small and entirely in front of
   * the operator: a wizard that counts to 9/7 and asks two questions after it
   * claimed to be finished.
   */
  it("counts the questions it actually asks", () => {
    const { counted, asked } = bootstrapQuestions();

    expect(
      asked,
      "question_keys and the question blocks have drifted apart; the numbering " +
        "in the prompts is taken from the list, not from the blocks",
    ).toEqual(counted);
  });

  /**
   * A key here that the schema does not accept is a question whose answer is
   * written into `.env` and then ignored — and `has_value` would never match
   * it, so it would be asked again on every single run.
   */
  it("asks about settings that exist", () => {
    const { counted } = bootstrapQuestions();
    const known = new Set<string>(ENV_VARIABLE_NAMES);

    expect(counted.filter((key) => !known.has(key))).toEqual([]);
  });

  /**
   * DB_PORT and APP_PORT are Compose's `[address:]port`, and a bare number is
   * not the careful reading of one: it is every interface. The wizard used to
   * answer a busy port with exactly that, so a host whose 5458 was taken got
   * its database put on the network by the step meant to fix a collision.
   * Every value it writes into either one says where, out loud.
   */
  it("writes an address into every published port", () => {
    const source = readFileSync(
      path.join(process.cwd(), "scripts", "bootstrap.sh"),
      "utf8",
    );
    const writes = [
      ...source.matchAll(/write_setting (APP_PORT|DB_PORT|"\$key") "([^"]*)"/g),
    ].map((match) => match[2]);

    expect(writes.length, "found no port the wizard writes").toBeGreaterThan(0);
    for (const value of writes) {
      expect(value).toMatch(/^(127\.0\.0\.1|0\.0\.0\.0):\$/);
    }
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
  // Read by the migration runner, which runs before the app and needs nothing
  // from the schema but a connection string.
  ALLOW_NEWER_SCHEMA: "isNewerSchemaAllowed",
};

/**
 * Known gaps: accepted, forwarded, documented, and acted on by nothing.
 *
 * Every name here is a bug waiting for someone to come back for it, not a
 * decision. Fixing one means deleting its line — and each fix is its own
 * branch, so this list is where they wait rather than being forgotten.
 */
const NOT_YET_READ = new Set<string>([]);

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

/**
 * Every `tsx` process package.json starts.
 *
 * One script can start more than one — `pnpm dev` copies the PDF assets before
 * it hands over to Next — so each `tsx` in a command line counts on its own.
 */
function tsxInvocations(): { script: string; invocation: string }[] {
  const source = readFileSync(path.join(process.cwd(), "package.json"), "utf8");
  const { scripts } = JSON.parse(source) as {
    scripts: Record<string, string>;
  };

  return Object.entries(scripts).flatMap(([script, command]) =>
    command
      .split("&&")
      .map((part) => part.trim())
      .filter((part) => part.startsWith("tsx "))
      .map((invocation) => ({ script, invocation })),
  );
}

describe("configuration reaches the standalone scripts", () => {
  /**
   * Next reads `.env.local` and `.env` for `next dev` and `next build`. A tsx
   * script is a plain Node process and reads neither, which made the setup in
   * docs/development.md wrong as written: copy `.env.example` to `.env.local`,
   * fill in DATABASE_URL, and `pnpm db:migrate` still failed with "DATABASE_URL
   * is required to run migrations" — while `pnpm dev`, two lines further down
   * the same page, was perfectly happy. `scripts/load-env.ts` is the fix, and
   * the next script added here forgetting it is how the bug comes back.
   */
  it("preloads the env files into every tsx entry", () => {
    const preload = "--import ./scripts/load-env.ts";

    // First on the line, not merely somewhere on it: an `--import` that lands
    // after the entry file is an argument to the script rather than a flag to
    // Node, and quietly loads nothing.
    const missing = tsxInvocations().filter(
      ({ invocation }) =>
        !invocation.startsWith(`tsx ${preload}`) &&
        !invocation.startsWith(`tsx watch ${preload}`),
    );

    expect(
      missing,
      "these run with none of the .env files loaded, so a setting made in " +
        `.env.local is invisible to them. Put \`${preload}\` first:\n` +
        missing.map(({ script }) => `  ${script}`).join("\n"),
    ).toEqual([]);
  });
});
