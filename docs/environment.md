# Environment reference

Every setting Balancia reads, what it does, and what happens if it is wrong.

Configuration is validated with zod at startup. A bad value stops the process
with a message naming the variable and what to fix, rather than letting the app
half-work until someone hits the broken path.

Under Docker Compose, **every variable is optional** — the defaults plus
generated secrets produce a working localhost install. Set them in `.env` next
to `compose.yaml`. For local development without Docker, use `.env.local`.

---

## Required outside Docker

### `DATABASE_URL`

PostgreSQL connection string. Must start with `postgres://` or `postgresql://`.

```bash
DATABASE_URL=postgres://balancia:password@localhost:5432/balancia
```

Under Compose this is assembled from the generated password; do not set it
there.

### `AUTH_SECRET`

Instance secret, at least 32 characters of randomness.

```bash
AUTH_SECRET=$(openssl rand -base64 48)
```

Generated and persisted automatically under Compose. Changing it invalidates
nothing stored (session tokens are random and stored hashed), but it is treated
as instance-identifying material — keep it in your backups. In production,
values that look like placeholders (`changeme`, `password`, …) are rejected at
startup.

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

## Instance policy

### `ALLOW_REGISTRATION`

Default `true`. Set `false` to close sign-ups on a private instance. The
register page then explains that registration is closed. Existing accounts and
guest invitation links keep working.

To create accounts on a closed instance, set it `true` briefly, register, and
set it back.

### `AUTH_RATE_LIMIT_MAX`

Default `0`, meaning the built-in protective limits apply:

| Action                 | Limit                    |
| ---------------------- | ------------------------ |
| Sign in                | 10 per IP per 5 minutes  |
| Register               | 5 per IP per hour        |
| Password reset request | 5 per IP per hour        |
| Guest link redemption  | 20 per IP per 10 minutes |
| Receipt upload         | 60 per IP per 10 minutes |

A non-zero value raises the three credential limits. **Only do this where many
legitimate attempts genuinely share one address** — an automated test suite
against a private instance. On a public deployment these limits are what make
password guessing and account enumeration expensive.

Rate limiting keys on the client IP, taken from `X-Forwarded-For` or
`X-Real-IP`. If your proxy does not set those, every request looks like one
client and the limits apply to everyone collectively.

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
