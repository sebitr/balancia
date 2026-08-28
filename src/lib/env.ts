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

    /**
     * Optional only because a demo instance genuinely has no database — see
     * DEMO_MODE. Every other deployment is required to set it, which the
     * `superRefine` below enforces with a message that says so.
     */
    DATABASE_URL: optionalString
      .refine(
        (value) =>
          value === undefined ||
          value.startsWith("postgres://") ||
          value.startsWith("postgresql://"),
        "DATABASE_URL must be a PostgreSQL connection string",
      )
      // Almost always an unencoded password. A literal '/', '#' or '?' ends the
      // authority section, and what follows is no longer a host and port, so
      // the URL fails to parse — with a message that never mentions the
      // password. Say so here instead. ('@' and '%' parse fine.)
      .refine(
        (value) => value === undefined || URL.canParse(value),
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

    /**
     * How many reverse proxies stand in front of Balancia.
     *
     * Rate limiting keys on the client address, which is read out of
     * `X-Forwarded-For` — a header every proxy *appends* to and every client
     * may open. Only the entries the proxies wrote can be believed, and this
     * says how many those are, counted from the right.
     *
     * The default of 1 is the single proxy in docs/self-hosting.md. Raise it
     * to 2 when something else terminates first — a CDN, or Cloudflare in
     * front of nginx — otherwise every visitor arrives wearing that edge's
     * address and shares one bucket with everybody else behind it. Never raise
     * it past the number of proxies actually there: each extra hop hands one
     * more entry back to the caller, and the entries the caller writes are the
     * ones that make a limit free to walk through.
     */
    TRUSTED_PROXY_HOPS: z.coerce.number().int().min(1).max(10).default(1),

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

    /**
     * Web Push (VAPID). Optional: without a key pair the app still notifies
     * people in its own interface, and only the push delivery is switched off.
     *
     * Generate a pair with `pnpm push:keys`. Both halves must come from the
     * same generation — they are checked against each other before the first
     * send. Replacing them invalidates every browser subscription.
     */
    PUSH_VAPID_PUBLIC_KEY: optionalString,
    PUSH_VAPID_PRIVATE_KEY: optionalString,
    /**
     * Contact address for the push service operators, `mailto:` or `https:`.
     * It goes into every VAPID token, so use an address you are willing to
     * hand to Google, Mozilla and Apple.
     */
    PUSH_VAPID_SUBJECT: optionalString,

    /**
     * Sign in with Apple. All four values come from one Apple Developer
     * account, and the feature is on exactly when all four are set.
     *
     * Off by default, and not because of the code: switching it on means every
     * sign-in attempt is a round trip to Apple, and it costs the operator a
     * paid Developer Program membership. Both are decisions for whoever runs
     * the instance. Nothing depends on it — passwords and passkeys are
     * unaffected. See docs/self-hosting.md.
     */

    /** Services ID identifier, e.g. `com.example.balancia.web`. Not the App ID. */
    APPLE_CLIENT_ID: optionalString,
    /** The 10-character Apple Developer team identifier. */
    APPLE_TEAM_ID: optionalString,
    /** The 10-character identifier of the private key below. */
    APPLE_KEY_ID: optionalString,
    /**
     * Contents of the `.p8` sign-in key, PKCS#8 PEM. Newlines may be written
     * as `\n`, because a multi-line value survives neither `.env` nor
     * compose's interpolation.
     */
    APPLE_PRIVATE_KEY: z
      .string()
      .transform((value) => value.trim().replace(/\\n/g, "\n"))
      .transform((value) => (value === "" ? undefined : value))
      .optional(),

    /** Disable open registration on a private instance. */
    ALLOW_REGISTRATION: booleanish.default(true),

    /**
     * Turns this whole process into a public demo.
     *
     * The instance stops using PostgreSQL entirely: `getDb()` returns an
     * in-memory database built at startup from the committed migrations (see
     * src/lib/db/demo-database.ts), so `DATABASE_URL` is not required and
     * nothing a visitor does is written anywhere. Background jobs are off with
     * it — pg-boss stores its queues in a real database.
     *
     * Signing in with `demo` / `demo` mints a throwaway account with its own
     * seeded groups, so two visitors never see each other's data. Everything
     * is swept after a couple of hours, and a restart is a clean slate.
     *
     * Meant for a deployment of its own, alongside the real one — see
     * docs/demo.md. Turning it on next to real accounts would hide them: the
     * process has one database and this replaces it.
     */
    DEMO_MODE: booleanish.default(false),

    /**
     * Where a demo of this instance lives, e.g. https://demo.balancia.app.
     *
     * Set on the *real* instance, not the demo one: it is what puts the "Try
     * the demo" link on the homepage. Left unset — the default — no such link
     * is rendered, so a self-hosted instance never advertises somebody else's
     * demo to its own users.
     */
    DEMO_URL: optionalString.refine(
      (value) => value === undefined || URL.canParse(value),
      "DEMO_URL must be an absolute URL, e.g. https://demo.balancia.app",
    ),

    /**
     * The way out of the demo: where signing out sends someone, e.g.
     * https://balancia.app.
     *
     * The mirror of DEMO_URL, and set on the *demo* instance. A demo has no
     * homepage of its own to return to — `/` goes straight to the sign-in
     * screen there — so without this, signing out would land back on the
     * sign-in screen the visitor just left, which reads as a failed sign-out.
     *
     * Unset, that is exactly what happens, and it is the only sensible default:
     * an instance cannot guess which site it is a demo of. Ignored entirely
     * when DEMO_MODE is off, where signing out has always gone to `/`.
     */
    DEMO_EXIT_URL: optionalString.refine(
      (value) => value === undefined || URL.canParse(value),
      "DEMO_EXIT_URL must be an absolute URL, e.g. https://balancia.app",
    ),

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

    /**
     * Provider base URL, a Frankfurter **v2** root. Point it at your own
     * instance if you run one.
     */
    EXCHANGE_RATE_API_URL: z
      .string()
      .url("EXCHANGE_RATE_API_URL must be an absolute URL")
      .default("https://api.frankfurter.dev/v2"),

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

    /**
     * On-device receipt scanning. Off by default, for the same two reasons as
     * the semantic model: it needs `'wasm-unsafe-eval'` in the
     * Content-Security-Policy, and it needs ~32 MB of OCR models under
     * `public/models` (`pnpm ocr:install`).
     *
     * Receipts can already be attached without it; this only adds reading
     * them. How they are read is the next two settings' business. See
     * docs/receipt-scanning.md.
     */
    RECEIPT_SCANNING: booleanish.default(false),

    /**
     * The on-device reader: PP-OCRv6 tiny in the browser, against models this
     * instance serves. On by default, because it is what receipt scanning has
     * always meant here and it is the only reader that needs no third party.
     *
     * Turning it off is for an instance that reads receipts exclusively
     * through `RECEIPT_OCR_PROVIDER`. That instance runs no WebAssembly of its
     * own, so it keeps the strict Content-Security-Policy and needs none of
     * the ~32 MB under `public/models`.
     *
     * One consequence worth knowing: pdf.js compiles WebAssembly for JBIG2 and
     * JPEG 2000 images, which a few scanners emit. Such a PDF cannot be drawn
     * on an instance with the strict policy. A PDF's *text* needs no codec, so
     * the common emailed-invoice case is unaffected either way.
     */
    RECEIPT_OCR_LOCAL: booleanish.default(true),

    /**
     * An optional server-side reader.
     *
     * Not a replacement for the on-device one, which since PP-OCRv6 tiny reads
     * an ordinary receipt well and costs nothing. This is for what a 6 MB
     * model cannot do: it returns structure directly instead of boxes a parser
     * has to interpret, and it copes with handwriting, unusual layouts and
     * scripts outside the recognizer's dictionary.
     *
     * This is the one place Balancia will send a receipt image somewhere to be
     * read, it is off by default, and the person scanning chooses it per scan
     * against an interface that says where the photograph is going. The call
     * is made by this server, never the browser, so the key stays here and the
     * page's `connect-src 'self'` is untouched.
     *
     * `openai` is also the driver for anything speaking the same protocol —
     * set `RECEIPT_OCR_BASE_URL` at Ollama, vLLM or LM Studio and the image
     * never leaves the operator's own hardware. That is the cheapest and most
     * private option, and on current open-weight document models the most
     * accurate one too; see docs/receipt-scanning.md.
     *
     * `mistral` is the odd one: a per-page-priced document endpoint rather
     * than a general vision model.
     */
    RECEIPT_OCR_PROVIDER: z
      .enum(["none", "anthropic", "openai", "gemini", "mistral"])
      .default("none"),
    RECEIPT_OCR_API_KEY: optionalString,
    /** Base URL override. Anything OpenAI-compatible, including a local one. */
    RECEIPT_OCR_BASE_URL: optionalString,
    /** Model id. Each driver has a sensible default; this overrides it. */
    RECEIPT_OCR_MODEL: optionalString,

    /**
     * What this deployment permits telemetry to do at all.
     *
     * The switch an administrator sees in Settings → Administration is the
     * *other* half of the decision, and it is off until somebody turns it on.
     * This one is the operator's ceiling, and it can only ever subtract:
     *
     *   opt-in  (default) — an administrator may switch reporting on. Until
     *                       one does, nothing is recorded and nothing is sent.
     *   local             — counters are recorded and can be previewed on this
     *                       instance, and nothing is ever transmitted.
     *   off               — no telemetry machinery runs. Stored opt-ins are
     *                       ignored, the switches are disabled and explained,
     *                       and no outbound request can be made.
     *
     * Note what the default does not do: `opt-in` sends nothing on its own.
     * It is a ceiling — it decides what an administrator is *allowed* to turn
     * on. The variable that decides where the switches start is
     * `TELEMETRY_DEFAULT` below; see docs/telemetry.md.
     */
    TELEMETRY_MODE: z.enum(["opt-in", "local", "off"]).default("opt-in"),

    /**
     * Whether crash classifications may be sent, separately from usage.
     *
     * Also a ceiling rather than a switch: with this true and the
     * administrator's crash setting off — its default — nothing is sent.
     * Setting it false takes the decision away from the UI entirely.
     */
    TELEMETRY_CRASH_REPORTS: booleanish.default(true),

    /**
     * The position both telemetry switches start in.
     *
     * The one telemetry variable that is a state rather than a ceiling, and it
     * is deliberately the weakest kind: it applies only while nobody has
     * answered. `setTelemetrySetting` stamps a timestamp on every write, so
     * the first time an administrator moves a switch their answer replaces
     * this for good — including an administrator who moves it back off.
     *
     * It exists because the alternative was worse in practice. A switch that
     * can only be found in Settings → Administration → Telemetry is a switch
     * most operators never see, so the honest description of the old default
     * was not "opt-in" but "off, permanently, by obscurity". The setup wizard
     * asks this out loud, which is what makes a default defensible.
     *
     * Still bounded by everything above it: `true` with `TELEMETRY_MODE=off`
     * sends nothing, and `true` with `TELEMETRY_CRASH_REPORTS=false` starts
     * usage reporting on and crash reporting off.
     */
    TELEMETRY_DEFAULT: booleanish.default(false),

    /**
     * How this instance is deployed, for the one coarse field that says so.
     * Compose sets it; everywhere else it is detected, and detection is
     * allowed to answer "unknown".
     */
    TELEMETRY_DEPLOYMENT: z.preprocess(
      (value) =>
        typeof value === "string" && value.trim() === "" ? undefined : value,
      z
        .enum(["docker-compose", "docker", "standalone", "development"])
        .optional(),
    ),

    /**
     * Run the *collector*: accept reports from other installations.
     *
     * Off everywhere except the one deployment that is telemetry.balancia.app,
     * where it is the whole job. With it off the receiving routes do not exist
     * — they answer 404, not 403, so an instance does not advertise a
     * collector it is not running.
     */
    TELEMETRY_RECEIVER: booleanish.default(false),

    /**
     * Prometheus metrics at /api/metrics, for the operator's own monitoring.
     *
     * Off by default and local always: these numbers are exact, unbucketed and
     * about this installation only. Nothing in Balancia ever transmits them.
     */
    METRICS_ENABLED: booleanish.default(false),

    /**
     * Bearer token required to read /api/metrics.
     *
     * Optional, because a operator who publishes the port only to a private
     * network has already answered the question. Without it and without such a
     * network, the endpoint is readable by anyone who can reach the app.
     */
    METRICS_TOKEN: optionalString,

    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace"])
      .default("info"),

    /**
     * Run the pg-boss worker inside the web process.
     *
     * On by default, so that one container is the whole application: an
     * operator who runs the image behind a reverse proxy, with no Compose file
     * and no second service, still gets recurring expenses, the notification
     * sweep and push delivery. The alternative used to be the default, which
     * meant every such install silently did none of that.
     *
     * A deployment that runs the dedicated worker container sets this to
     * false — see the `worker` profile in compose.yaml. Leaving it true there
     * is not corrupting (pg-boss hands each job to one subscriber) but it is
     * never what anybody meant, and `src/worker/index.ts` says so at startup.
     */
    RUN_WORKER_IN_WEB: booleanish.default(true),
  })
  .superRefine((value, context) => {
    /*
     * A demo instance builds its schema in memory and never connects to
     * PostgreSQL, so it is the one deployment for which a connection string is
     * not merely optional but meaningless. Everything else needs one, and gets
     * told which of the two it is.
     */
    if (!value.DEMO_MODE && value.DATABASE_URL === undefined) {
      context.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message:
          "DATABASE_URL is required. The only exception is a demo instance " +
          "(DEMO_MODE=true), which keeps its data in memory and connects to no database.",
      });
    }

    /*
     * A demo instance may well *have* a DATABASE_URL — it usually shares an
     * `.env` with the real stack, and the entrypoint assembles one from the
     * POSTGRES_* values. That is not a misconfiguration and is not refused
     * here; DEMO_MODE wins and `instrumentation.ts` says so at startup, where
     * an operator will actually see it.
     */

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

    /*
     * A v1 root parses cleanly and reaches a live server, so nothing would
     * fail loudly — the responses simply do not match what the provider reads,
     * and every lookup degrades to "no suggestion" with a line in the log.
     * That is the shape of bug an operator never goes looking for, so it is
     * refused at boot with the fix in the message.
     */
    if (
      value.EXCHANGE_RATE_PROVIDER === "frankfurter" &&
      /\/v1\/*$/.test(new URL(value.EXCHANGE_RATE_API_URL).pathname)
    ) {
      context.addIssue({
        code: "custom",
        path: ["EXCHANGE_RATE_API_URL"],
        message:
          `EXCHANGE_RATE_API_URL "${value.EXCHANGE_RATE_API_URL}" points at Frankfurter's v1 API, which is not supported: ` +
          "it republishes the ECB alone, so all but thirty currencies get no rate. Use the v2 root instead " +
          "(https://api.frankfurter.dev/v2), or unset it to take that default.",
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

    /*
     * A remote reader needs credentials, unless it is a local endpoint — an
     * Ollama or vLLM server on the operator's own network usually wants no key
     * at all, so a base URL is accepted in place of one.
     */
    if (
      value.RECEIPT_OCR_PROVIDER !== "none" &&
      !value.RECEIPT_OCR_API_KEY &&
      !value.RECEIPT_OCR_BASE_URL
    ) {
      context.addIssue({
        code: "custom",
        path: ["RECEIPT_OCR_API_KEY"],
        message:
          `RECEIPT_OCR_API_KEY is required when RECEIPT_OCR_PROVIDER is "${value.RECEIPT_OCR_PROVIDER}". ` +
          "Set RECEIPT_OCR_BASE_URL instead if the endpoint is a local one that needs no key.",
      });
    }

    /*
     * Only the Anthropic and Mistral drivers carry a default model. On the
     * other two the
     * model name belongs to whoever is serving the endpoint — an operator's
     * own Ollama, or an API whose version suffixes move — and a constant
     * compiled in here would eventually be a 404 at somebody's first scan
     * rather than an error at boot. This is that error at boot.
     */
    if (
      (value.RECEIPT_OCR_PROVIDER === "openai" ||
        value.RECEIPT_OCR_PROVIDER === "gemini") &&
      !value.RECEIPT_OCR_MODEL
    ) {
      context.addIssue({
        code: "custom",
        path: ["RECEIPT_OCR_MODEL"],
        message:
          `RECEIPT_OCR_MODEL is required when RECEIPT_OCR_PROVIDER is "${value.RECEIPT_OCR_PROVIDER}" — ` +
          "name the vision model the endpoint serves. The anthropic and mistral drivers have defaults.",
      });
    }

    // Scanning switched on with both readers switched off renders a button
    // that cannot do anything. Say so at boot rather than at the first scan.
    if (
      value.RECEIPT_SCANNING &&
      !value.RECEIPT_OCR_LOCAL &&
      value.RECEIPT_OCR_PROVIDER === "none"
    ) {
      context.addIssue({
        code: "custom",
        path: ["RECEIPT_OCR_LOCAL"],
        message:
          "RECEIPT_SCANNING is on but has no reader: RECEIPT_OCR_LOCAL is off and " +
          'RECEIPT_OCR_PROVIDER is "none". Turn one of them on, or turn scanning off.',
      });
    }

    if (value.SMTP_HOST && !value.SMTP_FROM) {
      context.addIssue({
        code: "custom",
        path: ["SMTP_FROM"],
        message: "SMTP_FROM is required when SMTP_HOST is configured",
      });
    }

    // Half a push key pair is always a mistake — usually a copied .env that
    // dropped the secret. Say so rather than silently disabling push.
    const pushHalves = [
      ["PUSH_VAPID_PUBLIC_KEY", value.PUSH_VAPID_PUBLIC_KEY],
      ["PUSH_VAPID_PRIVATE_KEY", value.PUSH_VAPID_PRIVATE_KEY],
    ] as const;
    const missing = pushHalves.filter(([, half]) => !half);
    if (missing.length === 1) {
      context.addIssue({
        code: "custom",
        path: [missing[0][0]],
        message:
          `${missing[0][0]} is required when the other half of the VAPID pair is set. ` +
          "Generate both with `pnpm push:keys`, or unset both to turn push off.",
      });
    }

    // Sign in with Apple needs all four values or none. Three of four is the
    // same mistake as half a VAPID pair, and it fails at the redirect rather
    // than at boot, so it is worth catching here.
    const appleParts = [
      ["APPLE_CLIENT_ID", value.APPLE_CLIENT_ID],
      ["APPLE_TEAM_ID", value.APPLE_TEAM_ID],
      ["APPLE_KEY_ID", value.APPLE_KEY_ID],
      ["APPLE_PRIVATE_KEY", value.APPLE_PRIVATE_KEY],
    ] as const;
    const appleSet = appleParts.filter(([, part]) => part);
    if (appleSet.length > 0 && appleSet.length < appleParts.length) {
      for (const [key, part] of appleParts) {
        if (part) continue;
        context.addIssue({
          code: "custom",
          path: [key],
          message:
            `${key} is required when the other Sign in with Apple settings are set. ` +
            "Set all four, or unset them all to turn Apple sign-in off. See docs/self-hosting.md.",
        });
      }
    }

    if (appleSet.length === appleParts.length) {
      // Apple will not redirect to plain HTTP or to localhost, so an instance
      // configured this way can never complete a sign-in. Better to say so at
      // boot than to let the operator debug Apple's own error page.
      if (appUrl.protocol !== "https:" || isLocalhost) {
        context.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message:
            `Sign in with Apple requires a public HTTPS APP_URL; "${value.APP_URL}" is not one. ` +
            "Apple refuses to redirect to http:// or to localhost. To try it locally, put a tunnel " +
            "in front and register that hostname with Apple.",
        });
      }

      for (const key of ["APPLE_TEAM_ID", "APPLE_KEY_ID"] as const) {
        if (!/^[A-Z0-9]{10}$/.test(value[key]!)) {
          context.addIssue({
            code: "custom",
            path: [key],
            message: `${key} should be the 10-character identifier Apple shows, e.g. "A1B2C3D4E5".`,
          });
        }
      }

      if (!/^-----BEGIN PRIVATE KEY-----/.test(value.APPLE_PRIVATE_KEY!)) {
        context.addIssue({
          code: "custom",
          path: ["APPLE_PRIVATE_KEY"],
          message:
            "APPLE_PRIVATE_KEY must be the contents of the .p8 file Apple issued, beginning " +
            '"-----BEGIN PRIVATE KEY-----" — not the file path, and not the key ID.',
        });
      }
    }

    if (
      value.PUSH_VAPID_SUBJECT &&
      !value.PUSH_VAPID_SUBJECT.startsWith("mailto:") &&
      !value.PUSH_VAPID_SUBJECT.startsWith("https://")
    ) {
      context.addIssue({
        code: "custom",
        path: ["PUSH_VAPID_SUBJECT"],
        message:
          'PUSH_VAPID_SUBJECT must be a "mailto:" address or an "https://" URL.',
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

/**
 * Every variable Balancia reads, as a list.
 *
 * Exported so a test can hold `compose.yaml` to it: a setting the containers
 * are never handed is a setting an operator can put in `.env` and watch do
 * nothing, which is how push notifications shipped switched off.
 */
export const ENV_VARIABLE_NAMES = Object.keys(
  envSchema.shape,
) as readonly (keyof typeof envSchema.shape)[];

export type RawEnv = z.infer<typeof envSchema>;

export interface AppEnv extends RawEnv {
  readonly appOrigin: string;
  readonly webAuthnRpId: string;
  readonly trustedOrigins: readonly string[];
  readonly smtpEnabled: boolean;
  readonly pushEnabled: boolean;
  readonly appleSignInEnabled: boolean;
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
    pushEnabled: Boolean(
      value.PUSH_VAPID_PUBLIC_KEY && value.PUSH_VAPID_PRIVATE_KEY,
    ),
    appleSignInEnabled: Boolean(
      value.APPLE_CLIENT_ID &&
      value.APPLE_TEAM_ID &&
      value.APPLE_KEY_ID &&
      value.APPLE_PRIVATE_KEY,
    ),
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

/**
 * Whether on-device receipt scanning is switched on.
 *
 * Read the same way and for the same reason as the flag above.
 */
export function isReceiptScanningEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return TRUTHY.includes((source.RECEIPT_SCANNING ?? "").trim().toLowerCase());
}

/**
 * Whether the browser-side receipt reader is switched on.
 *
 * Defaults to true, so an instance that predates the provider setting keeps
 * the behaviour it has always had. Read the same way as the flags above, and
 * for the same reason.
 */
export function isLocalReceiptOcrEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = (source.RECEIPT_OCR_LOCAL ?? "").trim();
  return raw === "" ? true : TRUTHY.includes(raw.toLowerCase());
}

/**
 * What to call the configured server-side reader, on screen.
 *
 * The interface promises to say where a photograph is going, so this has to
 * be true rather than tidy. Two of the drivers are one vendor each and can be
 * named. The third is a protocol, not a vendor: `openai` pointed at a base
 * URL is usually the operator's own Ollama or vLLM, and calling that "OpenAI"
 * would be a false statement about who receives the image — so it is named by
 * its host instead.
 *
 * Returns `undefined` when no provider is configured, which is what makes the
 * choice disappear from the interface rather than appearing greyed out.
 */
export function configuredOcrProviderName(
  source: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const provider = (source.RECEIPT_OCR_PROVIDER ?? "").trim().toLowerCase();
  const baseUrl = (source.RECEIPT_OCR_BASE_URL ?? "").trim();

  switch (provider) {
    case "anthropic":
      return "Claude";
    case "gemini":
      return "Gemini";
    case "mistral":
      return "Mistral OCR";
    case "openai": {
      if (!baseUrl) return "OpenAI";
      try {
        return new URL(baseUrl).host;
      } catch {
        // A base URL that will not parse is a misconfiguration the schema
        // reports elsewhere; say something neutral rather than nothing.
        return "the configured reader";
      }
    }
    default:
      return undefined;
  }
}

/**
 * Whether anything in this instance needs to compile WebAssembly.
 *
 * Both optional local-inference features run on onnxruntime-web, and both need
 * the same one CSP token. Asking the question once here means the policy has a
 * single reason to be relaxed, and adding a third such feature does not mean
 * remembering to touch `proxy.ts`.
 *
 * Receipt scanning only counts when its *browser* reader is the one doing the
 * work. An instance reading receipts through `RECEIPT_OCR_PROVIDER` alone
 * compiles nothing, and would otherwise have had its policy relaxed for a
 * model it never loads.
 */
export function isWebAssemblyInferenceEnabled(
  source: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    isSemanticCategorizationEnabled(source) ||
    (isReceiptScanningEnabled(source) && isLocalReceiptOcrEnabled(source))
  );
}
