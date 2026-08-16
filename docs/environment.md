# Environment reference

Every setting Balancia reads, what it does, and what happens if it is wrong.

Configuration is validated with zod at startup. A bad value stops the process
with a message naming the variable and what to fix, rather than letting the app
half-work until someone hits the broken path.

Under Docker Compose, **only `AUTH_SECRET` and `POSTGRES_PASSWORD` are
required**, and `./scripts/bootstrap.sh` writes both into `.env` for you.
Everything else defaults to a working localhost install. Set overrides in that
same `.env`, next to `compose.yaml`. For local development without Docker, use
`.env.local`.

Run from a terminal, `bootstrap.sh` also asks about the optional features and
writes the answers: `APP_URL`, `ALLOW_REGISTRATION`, `EXCHANGE_RATE_PROVIDER`,
`RECEIPT_SCANNING`, `SEMANTIC_CATEGORIZATION`, the `PUSH_VAPID_*` trio and the
`SMTP_*` group. Anything it writes can be edited here afterwards; nothing here
has to go through it.

---

## Required

### `POSTGRES_PASSWORD`

**Compose only.** The password for the `balancia` database role. Written by
`scripts/bootstrap.sh`; used both to initialise the database and to assemble
`DATABASE_URL`. Any characters are fine — the container percent-encodes it
before building the URL.

It is applied **only when the cluster is first created.** Changing it later
edits the connection string without changing the password PostgreSQL actually
expects, and the app stops being able to connect. To rotate it, `ALTER ROLE
balancia WITH PASSWORD '…'` and update `.env` to match.

### `DATABASE_URL`

PostgreSQL connection string. Must start with `postgres://` or `postgresql://`.

```bash
DATABASE_URL=postgres://balancia:password@localhost:5432/balancia
```

Under Compose the entrypoint assembles this from `POSTGRES_PASSWORD`,
percent-encoding the password. Set it explicitly only to point the app at a
database outside the Compose project; an explicit value always wins.

When you do set it by hand and the password contains `/`, `#` or `?`,
percent-encode it yourself. Those characters end the URL's authority section,
so what follows is no longer read as a host and port and the string fails to
parse. Startup names that cause rather than passing a bare "Invalid URL"
through from the driver. (`@` and `%` need no encoding.)

### `AUTH_SECRET`

Instance secret, at least 32 characters of randomness.

```bash
AUTH_SECRET=$(openssl rand -base64 48)
```

Written into `.env` by `scripts/bootstrap.sh` on first run. Changing it
invalidates nothing stored (session tokens are random and stored hashed), but it
is treated as instance-identifying material — keep it in your backups. In
production, values that look like placeholders (`changeme`, `password`, …) are
rejected at startup.

---

## Public URL and passkeys

### `APP_URL`

Default `http://localhost:3000`. The URL people actually type, including scheme
and any non-default port. Used for absolute links, invitation links, and as the
expected WebAuthn origin.

```bash
APP_URL=https://balancia.example.com
```

**Must be HTTPS unless the host is localhost.** Balancia refuses to start
otherwise, because browsers refuse WebAuthn on plain HTTP and a passkey feature
that silently cannot work is worse than a clear failure. `localhost`,
`127.0.0.1`, `[::1]` and `*.localhost` are exempt.

### `WEBAUTHN_RP_ID`

Defaults to `APP_URL`'s hostname, which is correct for nearly every install.

Set it only to share passkeys across subdomains — for example `example.com` so a
passkey works on both `app.example.com` and `www.example.com`.

It must equal the `APP_URL` host or be a registrable parent domain of it.
Anything else is rejected at startup: an inconsistent relying-party ID produces
passkeys that appear to register and then fail to authenticate, which is
miserable to debug.

**Changing this invalidates every existing passkey.** Credentials are bound to
the relying-party ID by the authenticator.

### `WEBAUTHN_RP_NAME`

Default `Balancia`. The name shown in the browser's passkey prompt.

### `TRUSTED_ORIGINS`

Comma-separated extra origins permitted to call the app. `APP_URL` is always
trusted; this is for the rare case of an additional legitimate front door.

```bash
TRUSTED_ORIGINS=https://alt.example.com,https://other.example.com
```

---

## Database

### `DATABASE_POOL_MAX`

Default `10`. Maximum PostgreSQL connections per process. Remember the worker
opens its own pool, so plan for roughly `2 × DATABASE_POOL_MAX` plus pg-boss's
own small pool against PostgreSQL's `max_connections`.

---

## Receipt storage

### `STORAGE_DRIVER`

`local` (default) or `s3`.

`local` writes to `STORAGE_LOCAL_PATH`, which Compose maps to the
`balancia-uploads` volume. Nothing serves that directory statically — every
download goes through an authorization check.

### `STORAGE_LOCAL_PATH`

Default `./data/uploads`, `/data/uploads` inside the container. Only used with
the `local` driver.

### `UPLOAD_MAX_BYTES`

Default `10485760` (10 MiB). Maximum size of a single receipt.

If you raise it, raise your reverse proxy's body limit too, or the proxy will
reject the upload before Balancia sees it (`client_max_body_size` in nginx).

### S3-compatible storage

Required when `STORAGE_DRIVER=s3`:

| Variable               | Notes                                                           |
| ---------------------- | --------------------------------------------------------------- |
| `S3_BUCKET`            | Bucket name. Required.                                          |
| `S3_REGION`            | Region. Required — use `us-east-1` for services that ignore it. |
| `S3_ENDPOINT`          | Custom endpoint for MinIO, Garage, R2, Backblaze… Omit for AWS. |
| `S3_ACCESS_KEY_ID`     | Omit to use the ambient credential chain (IAM role, env).       |
| `S3_SECRET_ACCESS_KEY` | As above.                                                       |
| `S3_FORCE_PATH_STYLE`  | `true` for most self-hosted S3 services.                        |

Objects are written with a private ACL and always served through Balancia's
authorized route, so a leaked bucket URL is not a leaked receipt.

---

## Email (optional)

Balancia works fully without SMTP. What you lose is email verification and
password recovery — both simply are not offered, rather than half-working.

| Variable                      | Notes                                                      |
| ----------------------------- | ---------------------------------------------------------- |
| `SMTP_HOST`                   | Enables email when set together with `SMTP_FROM`.          |
| `SMTP_PORT`                   | Defaults to 587, or 465 when `SMTP_SECURE=true`.           |
| `SMTP_USER` / `SMTP_PASSWORD` | Omit both for an unauthenticated relay.                    |
| `SMTP_SECURE`                 | `true` for implicit TLS (port 465).                        |
| `SMTP_FROM`                   | Required when `SMTP_HOST` is set. Startup fails otherwise. |

**Turning SMTP on changes registration:** new accounts must confirm their email
before they can sign in. Turning it on after people have registered leaves
existing accounts unverified and therefore unable to sign in — verify them
manually if you do this:

```sql
UPDATE users SET email_verified_at = now() WHERE email_verified_at IS NULL;
```

---

## Push notifications (optional)

Balancia notifies people inside the app with no configuration at all: the bell
in the header and `/notifications` work out of the box. What a VAPID key pair
adds is **push** — reaching a phone or a laptop when Balancia is closed.

Generate a pair once:

```bash
pnpm push:keys
```

| Variable                 | Notes                                                                       |
| ------------------------ | --------------------------------------------------------------------------- |
| `PUSH_VAPID_PUBLIC_KEY`  | base64url P-256 public key. Also handed to browsers as the subscribe key.   |
| `PUSH_VAPID_PRIVATE_KEY` | base64url P-256 private key. A secret — treat it like `AUTH_SECRET`.        |
| `PUSH_VAPID_SUBJECT`     | `mailto:` address or `https:` URL. Defaults to `admin@<your APP_URL host>`. |

Setting only one of the two halves stops the app at startup rather than
silently disabling push, because that is nearly always a `.env` that lost its
secret. The halves are also checked against each other before the first send;
a mismatched pair disables push with an explanatory log line instead of
producing 401s from every push service.

**What this means for privacy.** Push notifications cannot be delivered by your
own server: browsers only accept them from the push service their vendor runs
(Google's for Chrome, Mozilla's for Firefox, Apple's for Safari). Balancia
encrypts every payload end to end with the subscription's own key (RFC 8291),
so the push service relays ciphertext it cannot read — but it does see _that_
a message went to a given device, and when. That is inherent to Web Push, not
to Balancia. Leave the keys unset and nothing contacts a third party; people
still get every notification inside the app.

**Rotating the keys invalidates every subscription.** Browsers bind a
subscription to the public key that created it, so everyone has to turn
notifications back on afterwards.

**Delivery needs the worker.** Push is sent from the background worker, like
recurring expenses. On a single-container install, set `RUN_WORKER_IN_WEB=true`
or nothing is delivered.

---

## Sign in with Apple (optional)

Off by default. Passwords and passkeys are unaffected by it; this adds a third
way in, and it is the one that involves somebody else's server.

| Variable            | Notes                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `APPLE_CLIENT_ID`   | The **Services ID** identifier, e.g. `com.example.balancia.web`.   |
| `APPLE_TEAM_ID`     | Your 10-character Apple Developer team ID.                         |
| `APPLE_KEY_ID`      | The 10-character ID of the sign-in key below.                      |
| `APPLE_PRIVATE_KEY` | Contents of the `.p8` key. A secret — treat it like `AUTH_SECRET`. |

Set all four or none: three of four stops the app at startup, naming the one
that is missing, rather than failing later at a redirect where the error is
Apple's and says nothing useful.

The step-by-step Apple Developer setup is in
[self-hosting.md](self-hosting.md#sign-in-with-apple).

**A multi-line value in a single-line file.** `APPLE_PRIVATE_KEY` is a PEM
block, and neither `.env` nor Compose interpolation carries real newlines.
Write them as `\n`, which Balancia unescapes:

```bash
APPLE_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' AuthKey_ABC1234567.p8)"
```

**`APP_URL` must be public HTTPS.** Apple refuses to redirect to `http://` or
to `localhost`, so an instance configured with both Apple sign-in and a
localhost URL is stopped at startup — it could never complete a sign-in. To try
it locally, put a tunnel in front and register that hostname with Apple; the
dev stack takes `DEV_APP_URL` for exactly this.

**What this means for privacy.** Every sign-in through this button is a
conversation between the person's browser and Apple, and then between this
instance and Apple's token endpoint. Apple learns that someone signed in to
your instance and when, and your instance's hostname is registered with Apple
in advance. Nothing about groups, expenses or balances is involved, and people
who use a password or a passkey never contact Apple at all. Leaving these unset
keeps the instance from talking to Apple.

**Hidden addresses work.** Someone choosing "Hide My Email" gets an
`@privaterelay.appleid.com` forwarder. Balancia stores it like any other
address; mail sent to it reaches them through Apple's relay. If you use
`SMTP_FROM` at a domain Apple does not know, register it with Apple as a
[Sign in with Apple email
source](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service)
or the relay will drop your mail.

**Linking to existing accounts is deliberate.** Balancia links an Apple account
to an existing local one automatically only when both sides have verified the
address — Apple says it verified it, and this instance did too. Otherwise the
person is asked to sign in the way they already can and link Apple from
_Profile → Passkeys & security_. Without that rule, anyone able to register with
an address they do not own could wait to inherit the account of whoever later
arrives through Apple. Note that an instance with no SMTP never verifies an
address, so on one of those the deliberate path is always the one taken.

---

## Instance policy

### `ALLOW_REGISTRATION`

Default `true`. Set `false` to close sign-ups on a private instance. The
register page then explains that registration is closed. Existing accounts and
guest invitation links keep working.

To create accounts on a closed instance, set it `true` briefly, register, and
set it back.

### `AUTH_RATE_LIMIT_MAX`

Default `0`, meaning the built-in protective limits apply:

| Action                   | Limit                        |
| ------------------------ | ---------------------------- |
| Sign in                  | 10 per IP per 5 minutes      |
| Register                 | 5 per IP per hour            |
| Password reset request   | 5 per IP per hour            |
| Guest link redemption    | 20 per IP per 10 minutes     |
| Receipt upload           | 60 per IP per 10 minutes     |
| Exchange-rate lookup     | 240 per IP per 10 minutes    |
| Push device registration | 30 per IP per 10 minutes     |
| Test notification        | 5 per account per 10 minutes |

A non-zero value raises the three credential limits. **Only do this where many
legitimate attempts genuinely share one address** — an automated test suite
against a private instance. On a public deployment these limits are what make
password guessing and account enumeration expensive.

Rate limiting keys on the client IP, taken from `X-Forwarded-For` or
`X-Real-IP`. If your proxy does not set those, every request looks like one
client and the limits apply to everyone collectively.

---

## Exchange rates (optional)

Both settings only affect _suggestions_. A rate can always be typed, whatever
they are set to, and a rate already recorded on an expense is never revisited.

### `EXCHANGE_RATE_PROVIDER`

`none` (default) | `frankfurter`.

Left at `none`, Balancia makes no outbound requests and the exchange-rate field
in the expense, settlement and recurring forms is filled in by hand — the
behaviour of every version before this setting existed.

Set to `frankfurter`, converted-currency groups get the rate for the day filled
in automatically, and the person entering the expense can still overwrite it.
[Frankfurter](https://frankfurter.dev) republishes the European Central Bank's
daily reference rates: no API key, no account, no per-request identity, roughly
30 currencies. Rates are cached in your own database, so a currency pair costs
at most one outbound request per day.

```bash
EXCHANGE_RATE_PROVIDER=frankfurter
```

What enabling this reveals to the provider: the IP of your _server_ (not your
users), and which currencies your groups use. Nothing about amounts, people or
groups leaves the instance.

### `EXCHANGE_RATE_API_URL`

Default `https://api.frankfurter.dev/v1`. Point it at your own Frankfurter
instance to keep rate traffic inside your network:

```bash
EXCHANGE_RATE_API_URL=https://rates.internal.example.com/v1
```

Rates the instance has already fetched keep working during an outage — a stale
quote is served rather than none — and the worker refreshes the pairs in active
use each weekday at 15:45 UTC, shortly after the ECB publishes.

---

## Expense categorization

Categories are suggested as an expense is typed, by rules that ship with
Balancia and by what your groups have corrected. That needs no configuration
and makes no outbound requests.

### `SEMANTIC_CATEGORIZATION`

`0` (default) | `1`.

Adds a semantic fallback for descriptions the rules do not cover — `Souper
chez Léa` rather than `MIGROS 1234`. Inference runs in the _browser_, against
model files served by your instance, so no transaction text leaves the device
and there is still no AI service involved.

It is off by default for two reasons that have nothing to do with privacy:

- it needs `'wasm-unsafe-eval'` in the Content-Security-Policy, which
  WebAssembly compilation requires and which is otherwise deliberately absent.
  Setting this variable to `1` is what adds it. It permits WASM compilation
  and nothing else — it is not `unsafe-eval`.
- it needs ~150 MB of model files under `public/models`, installed with an
  explicit command:

```bash
pnpm semantic:install --yes
SEMANTIC_CATEGORIZATION=true
```

With the variable set but the files missing, the browser makes one `HEAD`
request, finds nothing, and categorization stays on its rules. Nothing breaks
and nothing needs switching off.

In Docker the files live inside the image, so mount them to survive a rebuild.
See [Categorization](categorization.md) for the whole design.

---

## Receipt scanning

### `RECEIPT_SCANNING`

`0` (default) | `1`.

Reads a photographed receipt into an expense — merchant, date, line items and
total — which you then correct and assign to people. This switch turns the
feature on; `RECEIPT_OCR_LOCAL` and `RECEIPT_OCR_PROVIDER` below decide _how_ a
receipt is read, and at least one of them has to be usable or the instance
refuses to start.

The on-device reader is the default. It runs in the _browser_ against model
files served by your instance: the image is never uploaded to be read, and no
third-party service is involved. It is off by default for the same two reasons
as the semantic model, and neither of them is privacy:

- it needs `'wasm-unsafe-eval'` in the Content-Security-Policy. Setting either
  this or `SEMANTIC_CATEGORIZATION` to `1` adds it, once.
- it needs ~32 MB of model files under `public/models`:

```bash
pnpm ocr:install --yes
RECEIPT_SCANNING=true
```

With the variable set but the files missing, the browser makes one `HEAD`
request, finds nothing, and no scan button is rendered. The expense form is
unchanged.

### `RECEIPT_OCR_LOCAL`

`1` (default) | `0`.

The on-device reader. Leaving it on is the behaviour receipt scanning has
always had. Turn it off on an instance that reads only through a provider:
nothing is downloaded, and the Content-Security-Policy stays strict, because
`'wasm-unsafe-eval'` is granted for a reader that actually runs rather than for
a feature that is enabled.

Setting this to `0` with `RECEIPT_OCR_PROVIDER=none` while `RECEIPT_SCANNING=1`
is refused at boot — that is a scan button with nothing behind it.

One consequence of the strict policy: pdf.js compiles WebAssembly for JBIG2 and
JPEG 2000 images, which a few document scanners emit, so a PDF containing one
cannot be drawn on a provider-only instance. Reading a PDF's _text_ needs no
codec, so emailed invoices — the common case — are unaffected. Set this back to
`1` if your receipts arrive as JBIG2 scans.

### `RECEIPT_OCR_PROVIDER`

`none` (default) | `anthropic` | `openai` | `gemini` | `mistral`.

An optional server-side reader. Not a replacement for the on-device one, which
since PP-OCRv6 tiny reads an ordinary receipt well and costs nothing per scan;
this is for what a 6 MB model cannot do — handwriting, unusual layouts, scripts
outside its dictionary — and for getting structure back rather than text a
parser has to interpret. **Your server** makes the call, never the browser, so
the credential stays here and the page's `connect-src 'self'` is untouched.

A PDF is never sent: the browser reads its text layer when it has one and draws
its first page when it does not, so what reaches the provider is always an
image. A text PDF is therefore answered on the device even when a provider is
selected — exact, and free.

`openai` is the driver for the protocol rather than the vendor: with
`RECEIPT_OCR_BASE_URL` pointed at Ollama, vLLM or LM Studio it runs a vision
model on your own hardware and the image never leaves it. On current
open-weight document models that is also the most accurate and by far the
cheapest option — see the comparison in docs/receipt-scanning.md.

`mistral` is a purpose-built document endpoint priced per page rather than per
token, which makes the bill predictable. It has two generations in service at
$4 and $2 per 1,000 pages; the default tracks the newer, dearer one, and the
newer features are aimed at invoices and forms rather than receipts. See
docs/receipt-scanning.md.

The image is held in memory for the length of the call and never written to
storage. Keeping the photograph with the expense is the separate checkbox it
always was.

### `RECEIPT_OCR_API_KEY`

Required when a provider is set, unless `RECEIPT_OCR_BASE_URL` is also set — a
local endpoint usually wants no key, and an empty bearer is worse than none.

### `RECEIPT_OCR_BASE_URL`

Endpoint override. Anything speaking the provider's protocol, including your
own server.

### `RECEIPT_OCR_MODEL`

**Required** for `openai` and `gemini`. Defaulted for `anthropic`
(`claude-opus-5`) and `mistral` (`mistral-ocr-latest`). The other two have no
default on purpose: model
names on those endpoints belong to whoever serves them, and a constant baked
in here would eventually be a 404 at your first scan instead of an error at
boot. Set a cheaper model here if the default costs more than a scan is worth
to you — `claude-opus-5` is in the most expensive band of the options compared
in docs/receipt-scanning.md.

Note that this and `SEMANTIC_CATEGORIZATION` install _different_ onnxruntime
WebAssembly binaries, which are not interchangeable; enabling both costs about
25 MB more on disk and nothing at runtime.

Attaching the receipt image to the expense afterwards is a separate, explicit
choice, and stores the image on this server exactly as the paperclip button
always has. See [Receipt scanning](receipt-scanning.md) for the whole design.

---

## Telemetry

Balancia collects no telemetry from a self-hosted installation by default. The
variables below are the deployment's half of the decision; the other half is an
administrator's, in Settings → Administration → Telemetry, and both switches
there start off. **Effective state is the intersection: something happens only
if both halves say so.** No value of any variable here starts sending data on
its own. The whole design, and the exact list of fields, is in
[Telemetry](telemetry.md).

### `TELEMETRY_MODE`

`opt-in` (default) | `local` | `off`.

| Value    | Recorded locally                | Transmitted                       | Admin switches                |
| -------- | ------------------------------- | --------------------------------- | ----------------------------- |
| `opt-in` | only after an admin switches on | one report a week, if switched on | usable                        |
| `local`  | only after an admin switches on | never                             | usable (send disabled)        |
| `off`    | never                           | never                             | disabled, with a reason shown |

`off` is the deployment-level kill switch: stored opt-ins are ignored, no
counters are written, and no outbound request can be made whatever anyone
clicks.

### `TELEMETRY_CRASH_REPORTS`

Default `true` — meaning "an administrator _may_ switch crash reports on", not
that they are on. Set `false` to remove the option entirely.

Crash reports are separate from usage statistics in every respect: separate
setting, separate endpoint, separate default (off). What one contains is an
error class name and a component — `PostgresError_23505`, `job` — and nothing
else. Not the message, not the stack, not the request.

### `TELEMETRY_ENDPOINT`

Default `https://telemetry.balancia.app`. Must be HTTPS unless it points at
localhost.

**Deployment-level only, on purpose.** An endpoint that could be typed into the
administration UI would let anyone who reached that form aim the server's own
outbound requests at an address of their choosing — a request-forgery
primitive, with the server's network position. A fork that wants its
installations to report somewhere else sets this in the file only the operator
can edit.

The sender appends `/v1/report` or `/v1/crash`, so a collector behind a path
prefix is configured as e.g.
`https://collector.example.com/api/telemetry`.

### `TELEMETRY_DEPLOYMENT`

`docker-compose` | `docker` | `standalone` | `development`. Optional.

Labels reports with how Balancia is being run. `compose.yaml` sets it;
elsewhere it is detected (a container is recognised by `/.dockerenv`), and
detection is allowed to answer nothing rather than guess.

### `TELEMETRY_RECEIVER`

Default `false`. Switches on the _collecting_ side: `POST /v1/report` and
`POST /v1/crash` at `/api/telemetry/v1/…`.

This is what the official collector runs, and it is the same application in a
different role — which is what lets a fork collect its own without writing a
server. While it is off, the routes answer **404**, not 403: an instance that
is not collecting should not advertise that the endpoint would exist.

---

## Metrics

### `METRICS_ENABLED`

Default `false`. Exposes Prometheus metrics at `/api/metrics`: HTTP request
durations and status classes by route template, Server Action durations and
outcomes, background-job durations and failures by queue, database query
latency, connection-pool usage, memory, CPU and uptime.

These are **exact, local and never transmitted**. They are not telemetry and
share none of its code; the only way they leave the server is an operator
pointing their own scraper at them. See [Telemetry](telemetry.md#local-operational-metrics).

### `METRICS_TOKEN`

Optional bearer token required to read `/api/metrics`.

Optional because an operator who publishes the app's port only to a private
network has already answered the question. **If the port is reachable from
anywhere else, set this.** Without it, metrics are readable by anyone who can
reach the app: not financial data, but request rates, error rates and the
version you are running.

```bash
METRICS_ENABLED=true
METRICS_TOKEN=$(openssl rand -hex 32)
```

```bash
curl -H "Authorization: Bearer $METRICS_TOKEN" http://localhost:3000/api/metrics
```

---

## Logging and operations

### `LOG_LEVEL`

`fatal` | `error` | `warn` | `info` (default) | `debug` | `trace`.

Production emits newline-delimited JSON; development pretty-prints. Secrets,
tokens, passwords and connection strings are redacted before anything is
written, at any level.

### `NODE_ENV`

`development` | `test` | `production`. Set to `production` by the Docker image;
you should not need to set it yourself.

Seeding refuses to run when this is `production`.

### `APP_PORT`

Compose only. Host port the app is published on. Default `3000`.

### `RUN_MIGRATIONS`

Docker image only. Default `true`: the entrypoint applies pending migrations
before starting the web or worker process. Both containers doing this at once
is safe — the runner holds a PostgreSQL advisory lock, so the second waits and
then finds the schema current.

Set to `false` to take that over yourself, e.g. to apply migrations once and
confirm before rolling the app:

```bash
docker compose run --rm --entrypoint "node dist/migrate.js" app
```

---

## Worked examples

### Local development

```bash
# .env.local
DATABASE_URL=postgres://balancia:balancia@localhost:5432/balancia
AUTH_SECRET=dev-only-secret-0123456789abcdef0123456789abcdef
APP_URL=http://localhost:3000
LOG_LEVEL=debug
```

### Small private instance behind Caddy

```bash
# .env
APP_URL=https://balancia.example.com
ALLOW_REGISTRATION=false
```

Everything else defaults; secrets are generated.

### Instance with email and S3 receipts

```bash
# .env
APP_URL=https://balancia.example.com

SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=balancia@example.com
SMTP_PASSWORD=…
SMTP_FROM=Balancia <balancia@example.com>

STORAGE_DRIVER=s3
S3_BUCKET=balancia-receipts
S3_REGION=eu-west-1
S3_ENDPOINT=https://s3.example.com
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=true

UPLOAD_MAX_BYTES=20971520
```

Remember to raise the proxy's body limit to match `UPLOAD_MAX_BYTES`.
