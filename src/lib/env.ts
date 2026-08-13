import { z } from "zod";

/**
 * Runtime configuration, validated once at startup.
 *
 * A misconfigured instance should fail immediately with a message that says
 * what to fix, rather than half-working until someone tries to register a
 * passkey. WebAuthn in particular has cross-field rules (the relying-party ID
 * must match the public URL's host) that are checked here.
 */

const TRUTHY = ["1", "true", "yes", "on"];

const booleanish = z.union([z.boolean(), z.string()]).transform((value) => {
  if (typeof value === "boolean") return value;
  return TRUTHY.includes(value.trim().toLowerCase());
});

const optionalString = z
  .string()
  .transform((value) => value.trim())
  .transform((value) => (value === "" ? undefined : value))
  .optional();

/**
 * A port that may arrive as an empty string rather than not at all.
 *
 * compose.yaml passes optional settings through as `${VAR:-}`, so on an
 * instance with no SMTP configured the variable is present and empty. Without
 * this, `z.coerce.number()` turns "" into 0 and the `min(1)` check rejects it,
 * which stops the app and worker from booting at all. The string variants get
 * this for free from `optionalString`.
 */
const optionalPort = z.preprocess(
  (value) =>
    typeof value === "string" && value.trim() === "" ? undefined : value,
  z.coerce.number().int().min(1).max(65535).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),

    /** Public origin the app is served from, e.g. https://balancia.example.com */
    APP_URL: z
      .string()
      .url("APP_URL must be an absolute URL, e.g. https://balancia.example.com")
      .default("http://localhost:3000"),

    DATABASE_URL: z
      .string()
      .min(1, "DATABASE_URL is required")
      .refine(
        (value) =>
          value.startsWith("postgres://") || value.startsWith("postgresql://"),
        "DATABASE_URL must be a PostgreSQL connection string",
      )
      // Almost always an unencoded password. A literal '/', '#' or '?' ends the
      // authority section, and what follows is no longer a host and port, so
      // the URL fails to parse — with a message that never mentions the
      // password. Say so here instead. ('@' and '%' parse fine.)
      .refine(
        (value) => URL.canParse(value),
        "DATABASE_URL is not a parseable URL. If the password contains '/', '#' " +
          "or '?', percent-encode it — '/' becomes %2F, '#' becomes %23.",
      ),

    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),

    /**
     * Instance secret. Written to .env by `scripts/bootstrap.sh` on first run
     * and reused from there, so sessions survive restarts. Kept for
     * signing/derivation needs outside the session tokens themselves, which
     * are random and stored hashed.
     */
    AUTH_SECRET: z
      .string()
      .min(32, "AUTH_SECRET must be at least 32 characters of random data"),

    /** WebAuthn relying-party ID. Defaults to the APP_URL host. */
    WEBAUTHN_RP_ID: optionalString,
    /** Human-readable name shown in the passkey prompt. */
    WEBAUTHN_RP_NAME: z.string().default("Balancia"),
    /** Comma-separated extra origins allowed to call the auth API. */
    TRUSTED_ORIGINS: optionalString,

    /** Storage driver for receipt attachments. */
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_PATH: z.string().default("./data/uploads"),
    S3_BUCKET: optionalString,
    S3_REGION: optionalString,
    S3_ENDPOINT: optionalString,
    S3_ACCESS_KEY_ID: optionalString,
    S3_SECRET_ACCESS_KEY: optionalString,
    S3_FORCE_PATH_STYLE: booleanish.default(false),

    /** Maximum receipt upload size in bytes (default 10 MiB). */
    UPLOAD_MAX_BYTES: z.coerce
      .number()
      .int()
      .min(1024)
      .max(200 * 1024 * 1024)
      .default(10 * 1024 * 1024),

    /** SMTP is optional: without it, verification and recovery are disabled. */
    SMTP_HOST: optionalString,
    SMTP_PORT: optionalPort,
    SMTP_USER: optionalString,
    SMTP_PASSWORD: optionalString,
    SMTP_SECURE: booleanish.default(false),
    SMTP_FROM: optionalString,

    /** Disable open registration on a private instance. */
    ALLOW_REGISTRATION: booleanish.default(true),

    /**
     * Overrides the per-IP limit on credential endpoints (sign-in, sign-up,
     * password reset).
     *
     * Left at 0, the protective built-in limits apply. Raise it only where many
     * legitimate attempts share one address — an automated test suite against a
     * private instance. Never raise it on a public deployment: these limits are
     * what make password guessing and account enumeration expensive.
     */
    AUTH_RATE_LIMIT_MAX: z.coerce
      .number()
      .int()
      .min(0)
      .max(1_000_000)
      .default(0),

    /**
     * Exchange-rate provider used to *suggest* rates in the forms.
     *
     * Off by default: enabling it makes the instance talk to a third party,
     * which is a decision for whoever runs it, not a default. Nothing depends
     * on it — rates can always be typed, and recorded rates are frozen.
     */
    EXCHANGE_RATE_PROVIDER: z.enum(["none", "frankfurter"]).default("none"),

    /** Provider base URL. Point it at your own Frankfurter instance if you run one. */
    EXCHANGE_RATE_API_URL: z
      .string()
      .url("EXCHANGE_RATE_API_URL must be an absolute URL")
      .default("https://api.frankfurter.dev/v1"),

    /**
     * Semantic fallback for expense categorization.
     *
     * Off by default. Not because it costs privacy — inference runs in the
     * browser against model files this instance serves, and no text leaves
     * the device — but because it needs `'wasm-unsafe-eval'` in the
     * Content-Security-Policy and a few hundred megabytes of model files
     * under `public/models`. Relaxing the CSP is the operator's call.
     *
     * Categorization works fully without it: the deterministic rules are the
     * classifier, and this only adds a fallback for text they do not cover.
     * See docs/categorization.md.
     */
    SEMANTIC_CATEGORIZATION: booleanish.default(false),

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),

    /** Run the pg-boss worker inside the web process (single-container setups). */
    RUN_WORKER_IN_WEB: booleanish.default(false),
  })
  .superRefine((value, context) => {
    const appUrl = new URL(value.APP_URL);
    const rpId = value.WEBAUTHN_RP_ID ?? appUrl.hostname;

    // WebAuthn requires the RP ID to be the origin's host or a parent domain.
    const hostname = appUrl.hostname;
    const rpIsValid =
      hostname === rpId ||
      (hostname.endsWith(`.${rpId}`) && rpId.includes("."));
    if (!rpIsValid) {
      context.addIssue({
        code: "custom",
        path: ["WEBAUTHN_RP_ID"],
        message:
          `WEBAUTHN_RP_ID "${rpId}" is not valid for APP_URL host "${hostname}". ` +
          "The relying-party ID must equal the host or be a registrable parent domain of it.",
      });
    }

    // WebAuthn only works over HTTPS, except on localhost.
    const isLocalhost =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "[::1]" ||
      hostname.endsWith(".localhost");
    if (appUrl.protocol !== "https:" && !isLocalhost) {
      context.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message:
          `APP_URL "${value.APP_URL}" uses HTTP on a non-localhost host. ` +
          "WebAuthn (passkeys) requires HTTPS; put Balancia behind a TLS-terminating reverse proxy.",
      });
    }

    if (value.STORAGE_DRIVER === "s3") {
      for (const key of ["S3_BUCKET", "S3_REGION"] as const) {
        if (!value[key]) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} is required when STORAGE_DRIVER is "s3"`,
          });
        }
      }
    }

    if (value.SMTP_HOST && !value.SMTP_FROM) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_FROM"],
        message: "SMTP_FROM is required when SMTP_HOST is configured",
      });
    }

    if (
      value.NODE_ENV === "production" &&
      /^(change-?me|password|secret|balancia)/i.test(value.AUTH_SECRET)
    ) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_SECRET"],
        message:
          "AUTH_SECRET looks like a placeholder. Generate a real secret, e.g. `openssl rand -base64 48`.",
      });
    }
  });

export type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  readonly appOrigin: string;
  readonly webAuthnRpId: string;
  readonly trustedOrigins: readonly string[];
  readonly smtpEnabled: boolean;
  readonly isProduction: boolean;
  readonly isTest: boolean;
}

export class EnvironmentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EnvironmentError";
  }
}

function buildEnv(source: NodeJS.ProcessEnv): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map(
        (issue) => `  • ${issue.path.join(".") || "(root)"}: ${issue.message}`,
      )
      .join("\n");
    throw new EnvironmentError(
      `Balancia cannot start: invalid configuration.\n${details}\n\n` +
        "See docs/environment.md for the full reference.",
    );
  }

  const value = parsed.data;
  const appUrl = new URL(value.APP_URL);
  const appOrigin = appUrl.origin;
  const extraOrigins = (value.TRUSTED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return {
    ...value,
    appOrigin,
    webAuthnRpId: value.WEBAUTHN_RP_ID ?? appUrl.hostname,
    trustedOrigins: [appOrigin, ...extraOrigins],
    smtpEnabled: Boolean(value.SMTP_HOST && value.SMTP_FROM),
    isProduction: value.NODE_ENV === "production",
    isTest: value.NODE_ENV === "test",
  };
}

let cached: AppEnv | undefined;

/** Validated environment. Throws EnvironmentError on the first bad value. */
export function getEnv(): AppEnv {
  cached ??= buildEnv(process.env);
  return cached;
}

/** Test hook: parse an arbitrary environment without touching the cache. */
export function parseEnv(source: NodeJS.ProcessEnv): AppEnv {
  return buildEnv(source);
}

/** Test hook: forget the cached environment. */
export function resetEnvCache(): void {
  cached = undefined;
}

/**
 * Whether the semantic categorization layer is switched on.
 *
 * Read without validating the whole environment, because `proxy.ts` needs it
 * on every request and must not depend on the full schema parsing cleanly.
 */
export function isSemanticCategorizationEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return TRUTHY.includes(
    (source.SEMANTIC_CATEGORIZATION ?? "").trim().toLowerCase(),
  );
}
