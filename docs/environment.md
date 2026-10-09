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

The app and the standalone scripts — `pnpm db:migrate`, `pnpm db:seed`, the
worker, and everything else `package.json` runs through `tsx` — read the same
files, in the same order `next dev` does: `.env.local`, then `.env`, with the
`.env.development` and `.env.production` variants Next also honours in between.
A variable already set in the environment beats all of them, which is how
Compose configures a container that can see one of these files anyway — the
development stack mounts the working tree, `.env.local` included.

Run from a terminal in a checkout, `bootstrap.sh` first asks whether this host
pulls the published image or builds its own, and writes that as `COMPOSE_FILE`
below. A standalone install has no source to build, so it is not asked and
`COMPOSE_FILE` is written to pull. Then, either way, it asks about the optional
features and writes those answers too: `APP_URL`, `ALLOW_REGISTRATION`, `EXCHANGE_RATE_PROVIDER`,
`RECEIPT_SCANNING`, `SEMANTIC_CATEGORIZATION`, the `PUSH_VAPID_*` trio, the
`SMTP_*` group, `TELEMETRY_MODE` with `TELEMETRY_DEFAULT`,
`METRICS_ENABLED`, and `BACKUP_ALLOW_PRIVATE_ENDPOINTS`. Telemetry is asked as one question with two answers —
whether an administrator may turn it on, and whether it starts on — and writes
both variables. Anything it writes can be edited here afterwards; nothing here
has to go through it.

---

## Compose itself

Two variables in `.env` are read by Docker Compose rather than by Balancia. The
container never sees either one; they decide what Compose brings up in the
first place, which is why setting them has an effect that no application log
will explain.

### `COMPOSE_FILE`

Which Compose files an unqualified `docker compose` command is composing.
Written by `bootstrap.sh` — from its first question in a checkout, and without
asking in a standalone install, which can only pull — and safe to change by
hand afterwards.

```bash
COMPOSE_FILE=compose.yaml                       # build the app on this host
COMPOSE_FILE=compose.yaml:compose.image.yaml    # pull sebitro/balancia
```

`compose.yaml` alone is what Compose does when the variable is absent, so an
`.env` written before this question existed goes on building, unchanged.

The published image is built for `linux/amd64` and `linux/arm64` by
`.github/workflows/release.yml`, and pulling it saves each host the Next.js
build — on a small server, the heaviest thing it is ever asked to do.
`compose.image.yaml` overrides nothing else: the database, the volumes, the
environment and the entrypoint stay `compose.yaml`'s. Reading it needs Compose
2.24 or newer, for the `!reset` that drops the inherited build section;
`bootstrap.sh` checks the version and does not offer the choice below it.

An explicit `-f` on the command line wins over this variable, which is why
`docker compose -f compose.dev.yaml …` still means the development stack.

The operational side is in
[self-hosting.md](self-hosting.md#running-the-published-image).

### `COMPOSE_PROFILES`

Which optional services start. Balancia defines one profile, `worker` — see
[`RUN_WORKER_IN_WEB`](#run_worker_in_web), which it must be set alongside.

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

Required, with one exception: an instance running as a demo (`DEMO_MODE=true`)
keeps everything in memory and connects to no database, so it needs none. Every
other deployment is refused at startup without one. A demo instance that _has_
a `DATABASE_URL` — which happens when it shares an `.env` with the real stack —
ignores it, and says so in the log.

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

Written into `.env` by `scripts/bootstrap.sh` on first run. It is
instance-identifying material — keep it in your backups. In production, values
that look like placeholders (`changeme`, `password`, …) are rejected at startup,
as is anything with fewer than eight distinct characters, which was typed
rather than generated.

So is every secret this repository commits — the development stack's, CI's,
the end-to-end suite's and the image build's placeholder — whenever `APP_URL`
is not a loopback address. Those are published in the source and each is long
enough to pass the length rule, so an instance running one on a public address
has a secret anyone can look up. On localhost they are allowed, because CI and
the Docker build run production code under them there. `bootstrap.sh` looks
for all of these on every run and offers to generate a replacement.

Changing it signs nobody out and breaks no link: session and invitation tokens
are random values stored as hashes, and none of them is derived from this. The
one visible effect is on the group invite link, whose URL is also kept
encrypted under a key derived from this secret so that group settings can show
it again. After a rotation those links keep working for everyone holding them,
but the settings card can no longer display one — it says so, and offers to
mint a fresh link.

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

### Trusting another origin

There is no setting for it — `TRUSTED_ORIGINS` was accepted once, and nothing
ever read it. Balancia refuses a
state-changing request whose `Origin` names a different host from the one in
its `Host` header, and Next.js refuses a Server Action on the same comparison.
A second hostname proxied to the same instance passes both untouched, as long
as the proxy forwards `Host` — though passkeys, and every link Balancia
writes, still belong to `APP_URL`. The one arrangement that would need an
allow-list — a proxy that rewrites `Host` — cannot be given one at runtime:
Next.js's list is `serverActions.allowedOrigins`, which is compiled into the
server when the image is built. Forward `Host` instead. A line setting it in
an older `.env` is ignored.

### `TRUSTED_PROXY_HOPS`

Default `1`. How many reverse proxies stand in front of Balancia.

Rate limiting keys on the client address, which is read out of the
`X-Forwarded-For` header. That header is a list every proxy appends to and
every caller is free to open with entries of their own, so only its rightmost
entries — the ones the proxies wrote — mean anything. This says how many of
them to count back.

The default covers the single proxy in
[docs/self-hosting.md](self-hosting.md). Raise it to `2` when something else
terminates the connection first, such as Cloudflare in front of nginx:

```bash
TRUSTED_PROXY_HOPS=2
```

Getting it too low and getting it too high fail in opposite directions. Too
low, and every visitor arrives wearing the outer proxy's address, so one
shared bucket rate-limits all of them collectively. Too high, and each extra
hop reaches one entry further into the part of the list the caller wrote —
which lets a single client present a fresh address per request and walk
straight through the limits on sign-in, registration, password reset and join
links. Set it to the number of proxies actually in front, and no higher.

---

## Database

### `DATABASE_POOL_MAX`

Default `10`. Maximum PostgreSQL connections per process. The app container
opens one pool, and pg-boss a small one of its own alongside it. If you gave
the background jobs [their own container](#background-jobs), that is a second
app-sized pool as well — plan for roughly `2 × DATABASE_POOL_MAX` against
PostgreSQL's `max_connections` in that shape.

Every connection in the app's pool is opened with two limits, which are not
environment variables: PostgreSQL cancels a statement that runs for more than
30 seconds, and ends a transaction left idle inside for more than a minute. The
longest statements Balancia sends take seconds, and without the limits one
runaway query held its connection for as long as it liked — enough of them and
the pool ran dry for everybody. An installation that genuinely needs longer can
say so in the connection string: `?statement_timeout=120000` (milliseconds) at
the end of [`DATABASE_URL`](#database_url) overrides the default, which under
Compose means setting that variable yourself. Migrations connect on their own
and pg-boss keeps its own pool, so neither is bound by the defaults — though
both read `DATABASE_URL` too, and would take an override written there.

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

Default `10485760` (10 MiB). Maximum size of a single receipt. At most
`26214400` (25 MiB).

The ceiling is fixed when the image is built, not when it starts. Every
request passes through Balancia's own proxy layer (`src/proxy.ts`) before it
reaches a route, and Next.js keeps no more of a request body there than the
build allows — the rest is cut off without an error, and the upload fails as a
malformed form. Balancia builds with room for 25 MiB, and refuses to start with
a value above that, so the setting cannot promise what the server cannot
receive. The constant is `UPLOAD_CEILING_BYTES` in `src/lib/upload-limit.ts`,
for anyone building their own image who needs more.

The limit is enforced on the bytes that actually arrive, not on the size the
request declares, so an upload sent without a `Content-Length` is refused with
the same 413 as one that announced its size.

You should rarely need to raise it. Photographs are redrawn in the browser
before they are sent, at most 2560 pixels on the long side, which makes them a
megabyte or two; the setting mostly matters for long scanned PDFs.

If you raise it, raise your reverse proxy's body limit too, or the proxy will
reject the upload before Balancia sees it (`client_max_body_size` in nginx).

Separately from this, one group keeps at most 2 GiB of receipts, in at most
5,000 files, whatever this is set to. That is not a setting; see
`GROUP_STORAGE_MAX_BYTES` in `src/modules/attachments/service.ts`.

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
existing accounts unverified and therefore unable to sign in with a password.
Worse, the first time each of them proves the address — a reset link or a
sign-in code — Balancia removes every passkey, Apple link and API key the
account held before, because it cannot tell them from ones a stranger left on
an address that was never theirs (see `SECURITY.md`). Verify existing accounts
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

**Delivery needs the background jobs.** Push is sent from them, like recurring
expenses, and the app container runs them itself by default — so this works out
of the box. It stops working if `RUN_WORKER_IN_WEB` is off with nothing else
taking over; see [Background jobs](#background-jobs).

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
_Settings → Sign-in & security_. Without that rule, anyone able to register with
an address they do not own could wait to inherit the account of whoever later
arrives through Apple. Note that an instance with no SMTP never verifies an
address, so on one of those the deliberate path is always the one taken.

---

## Encrypted cloud backup (optional)

Lets the owner of a group back it up, encrypted, to a cloud storage account of
their own, on a schedule. The data is encrypted in the worker to a recovery key
that only the owner holds, so neither this server nor the cloud can read what
was written. How it works, the provider walk-throughs and the limits of each
are in [cloud-backup.md](cloud-backup.md); this section is only the settings.

**With none of these set the feature still works** for anyone who brings a
bucket (S3 and compatibles) or a WebDAV server (Nextcloud, ownCloud, kDrive):
the image carries `rclone`, and the details are the owner's. What the settings
below add is the three providers that need an app registered by whoever runs
the instance, and two decisions that are the operator's to make.

| Variable                         | Default  | Notes                                                                                                      |
| -------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `BACKUP_ALLOW_PRIVATE_ENDPOINTS` | `false`  | Let a backup go to an address on this server's own network, such as a NAS. See below before turning it on. |
| `BACKUP_EXPERIMENTAL_PROVIDERS`  | `false`  | Offer Proton Drive. It uses an interface the provider does not publish, and keeps a password on disk.      |
| `BACKUP_GOOGLE_CLIENT_ID`        | unset    | Google Drive. Both halves, or neither.                                                                     |
| `BACKUP_GOOGLE_CLIENT_SECRET`    | unset    |                                                                                                            |
| `BACKUP_DROPBOX_CLIENT_ID`       | unset    | Dropbox: the app key. Both halves, or neither.                                                             |
| `BACKUP_DROPBOX_CLIENT_SECRET`   | unset    | Dropbox: the app secret.                                                                                   |
| `BACKUP_MICROSOFT_CLIENT_ID`     | unset    | OneDrive (personal accounts). Both halves, or neither.                                                     |
| `BACKUP_MICROSOFT_CLIENT_SECRET` | unset    |                                                                                                            |
| `BACKUP_RCLONE_PATH`             | `rclone` | Only if the binary is somewhere `PATH` does not reach. The image puts it on `PATH`.                        |

A provider's tile is offered exactly when both halves of its pair are set, and
half a pair stops the app at startup, naming the missing one. Each registration
needs the redirect URI `<APP_URL>/api/backup/oauth/<google|dropbox|microsoft>/callback`
and nothing wider than the permissions listed in
[cloud-backup.md](cloud-backup.md#registering-the-apps).

**`BACKUP_ALLOW_PRIVATE_ENDPOINTS` is a trade, not a convenience.** Backing up
to a NAS is the commonest reason to self-host, and it needs this on. But the
address is typed by whoever owns a group, and the worker connects to it every
night; with it on, any account on this instance can make this server open
connections to anything it can reach — the database, an admin page on the
router. Turn it on for a household where everyone with an account is trusted.
The platform metadata address (`169.254.169.254`) stays refused either way.

**Rotating `AUTH_SECRET` disconnects every backup destination.** Their
credentials are sealed under a key derived from it, and a rotated secret cannot
open them: each destination shows "reconnect" and the owner re-enters or
re-authorises it. The backups already in the cloud are unaffected, because they
are encrypted to the owner's recovery key and not to anything on the server.

---

## Instance policy

### `ALLOW_REGISTRATION`

Default `true`. Set `false` to close sign-ups on a private instance. The
register page then explains that registration is closed. Existing accounts and
guest invitation links keep working.

To create accounts on a closed instance, set it `true` briefly, register, and
set it back.

### `SIGNUP_PROOF_OF_WORK`

Default `false`. Set `true` to make creating an account cost the visitor's
browser about a second of hashing before the server will look at it.

The register page asks this instance for a puzzle, solves it while the form is
being filled in, and sends the answer along with the signup; a signup without a
valid, unspent answer is refused. Somebody typing their name and password
notices nothing — the work finishes long before they press the button. A script
opening ten thousand accounts needs hours of compute it did not need before.

It is not a CAPTCHA and does not try to be one. It cannot tell a person from a
script, only a cheap script from an expensive one, and an attacker with rented
GPUs will still get through. What it removes is bulk signup from a laptop,
which is what the traffic actually looks like.

Leave it off on a private instance: [`ALLOW_REGISTRATION=false`](#allow_registration)
closes the door completely and costs your handful of users nothing. Turn it on
where registration has to stay open to strangers.

Nothing else changes when it is on. There is no third party involved, no
account to open anywhere, and an instance with no route to the internet works
exactly as one with a route does.

### `AUTH_RATE_LIMIT_MAX`

Default `0`, meaning the built-in protective limits apply:

| Action                   | Limit                        |
| ------------------------ | ---------------------------- |
| Sign in                  | 10 per IP per 5 minutes      |
| Sign in, one address     | 20 per email per hour        |
| Change password          | 10 per account per hour      |
| Register                 | 5 per IP per hour            |
| Register, one address    | 3 per email per day          |
| Register, whole instance | 50 per hour                  |
| Password reset request   | 5 per IP per hour            |
| Reset link, one inbox    | 3 per email per hour         |
| Sign-in code request     | 5 per IP per hour            |
| Sign-in code, one inbox  | 3 per email per hour         |
| Guest link redemption    | 20 per IP per 10 minutes     |
| Receipt upload           | 60 per IP per 10 minutes     |
| Exchange-rate lookup     | 240 per IP per 10 minutes    |
| Push device registration | 30 per IP per 10 minutes     |
| Test notification        | 5 per account per 10 minutes |

The two signup rows below the per-IP one are what a per-IP limit alone cannot
do. Registering mails whichever address the caller typed, so keyed on the
sender it can be aimed at somebody else's inbox from a pool of addresses; keyed
on the _recipient_ it cannot. The instance-wide row is the backstop against a
botnet, which is scarce in neither addresses nor targets.

The other _one address_ and _one inbox_ rows are there for the same reason.
Guessing at one account's password from many addresses never reaches the
per-IP sign-in row, and nor does a stream of reset links or codes aimed at one
inbox — each of which also cancelled the one before it. Past an inbox's share
the request is answered as though it had gone out and nothing is sent, so the
newest link or code stays live. The per-address sign-in row is spent for every
address typed, registered or not, so being refused by it says nothing about
which addresses have an account.

A non-zero value raises the credential limits. **Only do this where many
legitimate attempts genuinely share one address** — an automated test suite
against a private instance. On a public deployment these limits are what make
password guessing and account enumeration expensive.

Rate limiting keys on the client IP, taken from the rightmost entry of
`X-Forwarded-For` that a proxy wrote — see
[`TRUSTED_PROXY_HOPS`](#trusted_proxy_hops) — and from `X-Real-IP` when there
is no `X-Forwarded-For` at all. If your proxy sets neither, every request looks
like one client and the limits apply to everyone collectively.

An IPv6 client is counted by its /64 rather than by its address: one
subscriber is given at least that many addresses, and would otherwise take a
fresh allowance with each. An IPv4 address written as IPv6 (`::ffff:192.0.2.1`)
counts as the IPv4 address. Sessions and logs still record the address itself.

---

## Demo (optional)

Two settings, and they belong on two different deployments. The full guide is
[docs/demo.md](demo.md).

### `DEMO_URL`

Default unset. The address of a public demo of this instance. Setting it puts a
"Try the demo" link on the homepage, beside "Create an account".

```bash
DEMO_URL=https://demo.example.com
```

Goes on the **real** instance, not the demo one. Left unset, no link is
rendered — which is why a self-hosted deployment never advertises somebody
else's demo to its own users.

### `DEMO_MODE`

Default `false`. Turns this process **into** a demo.

The instance stops using PostgreSQL entirely. It builds the whole schema in
memory at startup from the committed migrations, and serves every query from
there. Nothing a visitor does is written to disk; restarting the container is
the reset. Signing in with `demo` / `demo` mints a throwaway account with its
own seeded groups, so two visitors never see each other's data, and each is
swept a couple of hours later.

```bash
DEMO_MODE=true
```

**Do not set this on the instance holding your real data.** There is one
database per process and this replaces it: every real account would be
unreachable until you turned it back off. Nothing is deleted — the database is
simply not read — but an app that works perfectly and has forgotten everyone is
an alarming thing to discover. `./scripts/bootstrap.sh` asks about it on every
run for that reason.

It belongs to a deployment of its own, on its own hostname, which is what
[compose.demo.yaml](../compose.demo.yaml) is.

A demo also skips its own homepage: opening `/` there goes straight to the
sign-in screen, because whoever followed a "Try the demo" link has already read
the pitch. That is what `DEMO_EXIT_URL` exists to undo on the way out.

### `DEMO_EXIT_URL`

Default unset. Where signing out of a demo goes.

```bash
DEMO_EXIT_URL=https://balancia.example.com
```

Goes on the **demo** instance — the mirror of `DEMO_URL`, which goes on the
real one. Since `/` on a demo redirects to the sign-in screen, there is no
homepage there to return to; without this, signing out lands back on the screen
the visitor just left and reads as a sign-out that failed.

Read only when `DEMO_MODE` is on. On a real instance signing out goes to `/`,
as it always has, whatever this is set to.

What a demo instance does not have: background jobs (pg-boss stores its queues
in a real database), so no recurring expenses are generated and no notification
is delivered. `DATABASE_URL` is not required, and is ignored if present.

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
[Frankfurter](https://frankfurter.dev) blends the daily rates published by some
eighty central banks: no API key, no account, no per-request identity, and 165
currencies — enough to cover all but a handful of what the picker offers. Rates
are cached in your own database, so a currency pair costs at most one outbound
request per day.

Rates are blended across sources rather than taken from one, so the last
decimal places of a suggestion can shift as a day's figures come in. Nothing
downstream depends on that: a suggestion is only ever a starting point, and the
rate written onto an expense is frozen the moment it is saved.

```bash
EXCHANGE_RATE_PROVIDER=frankfurter
```

What enabling this reveals to the provider: the IP of your _server_ (not your
users), and which currencies your groups use. Nothing about amounts, people or
groups leaves the instance.

### `EXCHANGE_RATE_API_URL`

Default `https://api.frankfurter.dev/v2`. Point it at your own Frankfurter
instance to keep rate traffic inside your network:

```bash
EXCHANGE_RATE_API_URL=https://rates.internal.example.com/v2
```

It must be a **v2** root. Frankfurter still serves v1, but v1 is the European
Central Bank alone — 30 currencies, so AED, UAH and 130-odd others get no rate
at all. A v1 URL fails no request and reaches a live server, so the only
symptom would be suggestions that never appear; the app refuses to start on one
instead, and names the fix.

Rates the instance has already fetched keep working during an outage — a stale
quote is served rather than none — and the worker refreshes the pairs in active
use each weekday at 15:45 UTC, after the European fixings.

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
administrator's, in Settings → Administration → Telemetry. **Effective state is
the intersection: something happens only if both halves say so.**
`TELEMETRY_MODE` and `TELEMETRY_CRASH_REPORTS` are ceilings and can only ever
subtract. `TELEMETRY_DEFAULT` is the one variable here that is a state: it
decides where the switches start, and stops applying to a switch the moment an
administrator moves it. The whole design, and the exact list of fields, is in
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

### `TELEMETRY_DEFAULT`

Default `false`. Where both switches start, until an administrator moves one.

This is the only telemetry variable that is a state rather than a ceiling, and
it is the weakest kind of state: `usage_reporting_changed_at` and
`crash_reporting_changed_at` are null until somebody moves the matching switch,
and this applies only while they are. The first time an administrator answers
— including answering "off" — their answer is stored with a timestamp and this
variable stops applying to that switch, on this installation and every upgrade
after. The two switches are tracked separately, so turning usage reporting off
leaves the default standing for crash reports.

It can only promote a switch, never suppress one: a switch stored as on stays
on with `TELEMETRY_DEFAULT=false`.

| Combination                                      | Result on a fresh install               |
| ------------------------------------------------ | --------------------------------------- |
| `TELEMETRY_DEFAULT=false` (default)              | nothing recorded, nothing sent          |
| `TELEMETRY_DEFAULT=true`                         | usage and crash reporting both on       |
| `TELEMETRY_DEFAULT=true`, `TELEMETRY_MODE=local` | counters recorded here, nothing sent    |
| `TELEMETRY_DEFAULT=true`, `TELEMETRY_MODE=off`   | nothing recorded, nothing sent          |
| `TELEMETRY_DEFAULT=true`, crash reports `false`  | usage reporting on, crash reporting off |

It exists because a switch that can only be found in an administration page is
one most operators never find, so the honest description of the previous
behaviour was not "opt-in" but "off unless somebody goes looking".
`scripts/bootstrap.sh` asks the question out loud, which is what makes a
default defensible; what would not be defensible is a default nobody was told
about.

### Where reports go — not a setting

There is deliberately no variable for the destination. It is a constant,
`https://balancia.app`, in `src/lib/telemetry/endpoint.ts`.

Configuration answers whether anything is sent — `TELEMETRY_MODE`, and the
administrator's switch, both of which default to sending nothing. It does not
answer to whom. Two reasons:

- An address that could be set from the administration UI would be
  server-side request forgery with this server's network position; one that
  could be set from the environment is a step away from the same thing, and is
  one more lever for anyone who talks their way onto the box.
- Every claim in [Telemetry](telemetry.md) is about a specific recipient. If
  the recipient were configurable, each of those claims would silently be
  "…unless somebody changed it", and a reader would have to check the
  environment before believing any of them.

A fork edits that one line — which under the AGPL it is building from source to
do anyway. See [Telemetry §14](telemetry.md).

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
outcomes, background-job durations and failures by queue, whether the
background worker is running and when the nightly maintenance sweep last
finished, database query latency, connection-pool usage, memory, CPU and
uptime. The alert to set up first is in
[self-hosting.md](self-hosting.md#alerting-on-the-background-jobs).

These are **exact, local and never transmitted**. They are not telemetry and
share none of its code; the only way they leave the server is an operator
pointing their own scraper at them. See [Telemetry](telemetry.md#local-operational-metrics).

### `METRICS_TOKEN`

Optional bearer token required to read `/api/metrics`.

Optional because an operator whose app can be reached only from a private
network has already answered the question. **If anything else can reach it —
through a reverse proxy counts, since the proxy forwards `/api/metrics` like
any other path — set this.** Without it, metrics are readable by anyone who can
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

## Background jobs

### `RUN_WORKER_IN_WEB`

Default `true`. Runs the pg-boss worker inside the web process: recurring
expenses, import commits, push delivery, exchange-rate refreshes and the
nightly housekeeping sweep.

On by default so that one container is the whole application. The image needs
no companion service — behind a reverse proxy, or as the single `app` service
of the Compose stack, it does all of its own work.

A worker that cannot reach its queue at startup does not stop the app serving
pages. It retries, from five seconds apart up to every five minutes, and says
where it stands in the `worker` field of `/api/health/ready` and in the
`balancia_worker_up` metric. On SIGTERM the app gives the jobs it is running up
to twenty seconds to finish before it exits.

Set it to `false` only when something else is running those jobs, which under
Compose means enabling the `worker` service. That takes a second line, because
a Compose profile is not an application setting:

```
COMPOSE_PROFILES=worker
RUN_WORKER_IN_WEB=false
```

The two failure modes are quiet ones, so they are worth naming. With the
profile on and this left `true`, both processes subscribe to every queue —
pg-boss hands each job to one of them, so nothing is duplicated or corrupted,
but nothing is gained either, and the worker logs a warning saying so. With
this `false` and no profile, **nothing runs the jobs at all**: the app serves
pages exactly as it should while no recurring expense is ever generated and no
push is ever sent.

`./scripts/bootstrap.sh` checks the pair on every run and offers to repair
either one. The operational side is in
[self-hosting.md](self-hosting.md#background-jobs).

---

## Logging and operations

### `LOG_LEVEL`

`fatal` | `error` | `warn` | `info` (default) | `debug` | `trace`.

Production emits newline-delimited JSON; development pretty-prints. Secrets,
tokens, passwords and connection strings are redacted before anything is
written, at any level, and a failed database statement is logged with its
SQLSTATE and statement text but without the values bound to it.

### `NODE_ENV`

`development` | `test` | `production`. Set to `production` by the Docker image;
you should not need to set it yourself.

Seeding refuses to run when this is `production`.

### `APP_PORT`

Compose only. Where the app is published on the host, as `address:port`.
Default `127.0.0.1:3000` — this host only.

The value is written into the published-port line verbatim, so it is Compose's
own syntax, and the address in front of the number is what decides who can
connect. Loopback is the default because the reverse proxy is meant to be the
only way in: it is what writes the client's address into `X-Forwarded-For`, and
rate limiting believes the rightmost entry — see
[`TRUSTED_PROXY_HOPS`](#trusted_proxy_hops). A caller who reaches the port
directly writes that entry themselves, and every per-address limit is then
keyed on a value they chose.

A proxy on the same host reaches the app at `127.0.0.1:3000`. A proxy running
as a container on the Compose project's network reaches it by service name,
`app:3000`, and needs no published port at all. Only a proxy on another machine
needs the app on the network, and then the address says so — the interface
that proxy reaches it through, or `0.0.0.0` for every one:

```bash
# .env
APP_PORT=10.0.0.5:3000
```

A bare number means the same as `0.0.0.0` to Compose — every interface — which
is why `bootstrap.sh` never writes one, and offers to put `127.0.0.1` in front
of one it finds.

### `DB_PORT`

Compose only. Where the database is published on the host, as `address:port`.
Default `127.0.0.1:5458` — this host only.

`compose.yaml` publishes PostgreSQL so that host tooling — `psql`, a GUI
client, `drizzle-kit`, a backup job — can reach it without going through a
container. It is kept to loopback because, anywhere else, the generated
`POSTGRES_PASSWORD` would be the only thing between the database and whoever
can reach this machine: Docker opens a published port with rules of its own,
ahead of a host firewall such as ufw, so that firewall is not consulted.

Connect from elsewhere by tunnelling, `ssh -L 5458:127.0.0.1:5458 you@host`.
The database is `balancia`, the user is `balancia`, and the password is
`POSTGRES_PASSWORD` from `.env`:

```bash
psql "postgres://balancia:$POSTGRES_PASSWORD@127.0.0.1:5458/balancia"
```

To put it on the network regardless, say so with the address —
`DB_PORT=0.0.0.0:5458`. As with `APP_PORT`, a bare number means every interface,
and `bootstrap.sh` asks about one it finds.

### `RUN_MIGRATIONS`

Docker image only. Default `true`: the entrypoint applies pending migrations
before starting the web or worker process. Two containers doing this at once is
safe — the runner holds a PostgreSQL advisory lock, so the second waits and
then finds the schema current.

Set to `false` to take that over yourself, e.g. to apply migrations once and
confirm before rolling the app. Under Compose it goes in `.env`, and
`compose.yaml` passes it to the app and the worker alike; each says in its log
that it skipped the step. For a single one-off command rather than the whole
stack, pass it to that command instead —
`docker compose run --rm -e RUN_MIGRATIONS=false app sh` starts a shell without
migrating first. Only the word `false` turns the step off. The migrations are
then yours to apply:

```bash
docker compose run --rm --entrypoint "node dist/migrate.js" app
```

An app started before its image's migrations have been applied answers
`/api/health/ready` with 503 — `pendingMigrations` in the body says how many
are missing — and becomes ready by itself as soon as they are.

### `ALLOW_NEWER_SCHEMA`

Whether a release may start against a database that a newer release has
already migrated. Unset, that is refused in production and allowed everywhere
else; `compose.yaml` passes `false`.

Every migration only goes forwards, and the runner knows only the migrations
its own image carries. A database holding one it has never heard of is almost
always an image rolled back after an upgrade, with the database left where the
upgrade put it — and the older code would then run against a schema it was
never written for. Some of what that breaks fails loudly; a column it does not
know to fill, or a table whose rows it does not know to read, is money that is
quietly wrong instead. So the migration step refuses, names the migrations it
does not know, and the container does not start.

The way back that loses nothing is to restore the dump taken before the
upgrade and then start the older release — see
[Rolling back](self-hosting.md#rolling-back). Set this to `true` only to run the
older release against the newer schema anyway, having decided to accept that:
it then starts, and logs a warning naming the migrations. Take it out again once
a current release is back, or it will wave the next mismatch through as well;
`./scripts/bootstrap.sh` offers to on every run.

Outside production the default is to warn and carry on, because there the
database is a development one that every branch migrates in turn, and stepping
back from a branch that added a migration is routine. `compose.dev.yaml` sets it
to `true` for the same reason; `DEV_ALLOW_NEWER_SCHEMA=false` shows the refusal
production gives.

Setting `RUN_MIGRATIONS=false` skips this check along with everything else the
migration step does.

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
