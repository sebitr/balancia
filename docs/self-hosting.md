# Self-hosting Balancia

Balancia is designed to be run by one person for a handful of people, on modest
hardware, with as few moving parts as possible: an app container and
PostgreSQL. No Redis, no message broker, no external services. The app runs its
own background jobs, so that is the whole stack until you decide otherwise.

## Quick start

```bash
git clone https://github.com/sebitr/balancia.git
cd balancia
./scripts/bootstrap.sh
docker compose up -d
```

Open <http://localhost:3000> and create the first account.

### What those commands set up

`bootstrap.sh` writes a `.env` holding this instance's own secrets. It needs
only a POSIX shell and `/dev/urandom`, and it never overwrites a value that is
already set — so re-running it is a no-op, and `./scripts/bootstrap.sh &&
docker compose up -d` is a safe habit.

Run from a terminal, the first thing it asks is where this host gets Balancia:
pull the published image, which is the default, or build one from the checkout.
It writes the answer as `COMPOSE_FILE`, which is what makes the plain `docker
compose up -d` above mean either one — see [Running the published
image](#running-the-published-image). Then it asks which optional features to
switch on:

| Question              | Writes                           | Also does                                     |
| --------------------- | -------------------------------- | --------------------------------------------- |
| Public URL            | `APP_URL`, `APP_PORT`, `DB_PORT` | Rejects HTTP outside localhost and busy ports |
| Open registration     | `ALLOW_REGISTRATION`             |                                               |
| Exchange rates        | `EXCHANGE_RATE_PROVIDER`         |                                               |
| Receipt scanning      | `RECEIPT_SCANNING`               | Downloads the OCR models                      |
| Semantic categorizing | `SEMANTIC_CATEGORIZATION`        | Downloads the embedding model                 |
| Push notifications    | `PUSH_VAPID_*`                   | Generates the VAPID pair                      |
| Outgoing email        | `SMTP_*`                         |                                               |
| Telemetry             | `TELEMETRY_MODE`                 | Switches nothing on — see below               |
| Metrics               | `METRICS_ENABLED`                | Generates `METRICS_TOKEN`                     |

Every answer is written, including the no's, so the second run asks nothing.
The two model downloads need Node; on a host that has only Docker, one is
borrowed from a throwaway `node:24-alpine` container for the length of the
download. If neither is there, the flag is still written and the script says
which command to run.

That is a deliberate pairing: a feature switched on whose model files are
missing renders no button and explains nothing, so the script that writes the
flag is the one that fetches the files. It re-checks on every run, in case a
download failed after the flag was written.

The port question appears only when it has to. Compose publishes the app on
`${APP_PORT:-3000}`, and if something on this host is already listening there,
`docker compose up` fails with `address already in use` — after the images have
been built. So the port is checked while it can still be changed: the script
offers the next free one, and checks every port you propose in turn. A
`localhost` URL moves with it, since the port is part of the address people
type; behind a proxy only `APP_PORT` changes, and the proxy has to be pointed
at it. Whichever of `ss`, `netstat` and `lsof` the host has is what answers the
question; on a host with none of them nothing is checked and nothing is asked.

The database's published port is checked in the same breath, and asked about
the same way. Nothing is written while `5458` is free, because that is the
number Compose defaults to anyway.

The telemetry question is the one that cannot switch a feature on. Balancia
sends nothing until an administrator turns it on inside the application, and
the question only writes whether they are allowed to: yes leaves the choice on
the administration page, no removes it for good. It is asked anyway, because an
operator who is never told the feature exists has not decided anything about
it. [Telemetry](telemetry.md) is the long version.

The metrics question is the opposite — it switches an endpoint on — so it
defaults to no, and answering yes generates a `METRICS_TOKEN` because the app's
port is published. If `METRICS_ENABLED` is set later by hand and no token is
set, a re-run offers to generate one; declining leaves it open, which is the
right answer only when that port is on a private network.

Nothing has to be answered interactively. With no terminal on stdin — CI, a
pipe — or with `--defaults`, it writes the secrets and leaves every optional
feature at its documented default. The port check is part of the question, so
it goes with it.

Compose then starts two services:

| Service | Role                                                                               |
| ------- | ---------------------------------------------------------------------------------- |
| `db`    | PostgreSQL 18. Published on `${DB_PORT:-5458}` — see below.                        |
| `app`   | The web application **and its background jobs**. Published on `${APP_PORT:-3000}`. |

A third service, `worker`, is defined but not started: the app does that work
itself. See [Background jobs](#background-jobs) below.

The database port is published on every interface this host has, so that
`psql`, a GUI client, `drizzle-kit` or a backup job can reach it directly. What
stands between it and anyone who can reach this machine is the password
`bootstrap.sh` generated — so on a host with a public address, put the bind
address in the setting and tunnel in instead:

```bash
# .env
DB_PORT=127.0.0.1:5458
```

```bash
ssh -L 5458:127.0.0.1:5458 you@host
psql "postgres://balancia:$POSTGRES_PASSWORD@127.0.0.1:5458/balancia"
```

The user and the database are both `balancia`; the password is
`POSTGRES_PASSWORD` from `.env`. Like the app's port, this one is checked
before the images are built rather than at `docker compose up`, where a port
already held on this host fails after the build.

Migrations are not a separate service. The image's entrypoint applies any
pending ones before the app starts, on every boot. Two containers doing it at
once is safe as well — the runner takes a PostgreSQL advisory lock, so the
second waits and then finds the schema already current. To take that over yourself, set
`RUN_MIGRATIONS=false` and run them explicitly:

```bash
docker compose run --rm --entrypoint "node dist/migrate.js" app
```

Two named volumes hold everything that matters:

| Volume             | Contents                |
| ------------------ | ----------------------- |
| `balancia-db-data` | The PostgreSQL database |
| `balancia-uploads` | Receipt files           |

### About the generated secrets

Nothing in this repository contains a usable production secret. `bootstrap.sh`
writes two random values into `.env`, both alphanumeric:

- `AUTH_SECRET` — 64 characters (~381 bits)
- `POSTGRES_PASSWORD` — 40 characters (~238 bits)

**Back up `.env`**: losing `AUTH_SECRET` signs everyone out, and losing
`POSTGRES_PASSWORD` locks you out of your own database.

To manage them yourself instead, just write them into `.env` before running
bootstrap — it will leave them alone:

```bash
AUTH_SECRET=$(openssl rand -base64 48)
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
```

`POSTGRES_PASSWORD` may contain any characters. The container percent-encodes
it before building the connection URL, so a `/` or `#` in a password you pasted
from a password manager will not break startup.

Note that `POSTGRES_PASSWORD` is applied only when the database cluster is
first created. Changing it later does not change the password PostgreSQL
actually expects, and the app will fail to connect; use `ALTER ROLE` for that.

---

## Running the published image

Every release is also published to Docker Hub as
[`sebitro/balancia`](https://hub.docker.com/r/sebitro/balancia), built for
`linux/amd64` and `linux/arm64`. Pulling it instead of building it saves each
host the app build — worth having on a small VPS, where that build is the
heaviest thing the machine is ever asked to do.

This is the first thing `bootstrap.sh` asks, and the default answer, so the
[quick start](#quick-start) above already covers it — nothing about those four
commands changes. What changes is one line in `.env`:

```bash
COMPOSE_FILE=compose.yaml:compose.image.yaml
```

Compose reads that out of `.env` before it composes anything, so every `docker
compose` command in this guide then means both files with no `-f` to remember.
Writing it by hand does exactly what answering the question does — which is how
an instance whose `.env` predates that question moves over, and how one moves
back: `COMPOSE_FILE=compose.yaml` builds here again.

`compose.image.yaml` overrides one thing: where `app` and `worker` get their
image. The database, the volumes, the environment and the entrypoint are
`compose.yaml`'s, unchanged. It drops the build section it inherits using
`!reset`, which arrived in Compose 2.24 — on anything older the file will not
parse, so `bootstrap.sh` checks the version, keeps quiet about the choice and
writes `COMPOSE_FILE=compose.yaml`.

| Tag       | What it is                                                  |
| --------- | ----------------------------------------------------------- |
| `latest`  | The newest release. Moves under you at every pull.          |
| `0.1.0`   | That release, permanently.                                  |
| `preview` | `main` as it is now, rebuilt on every merge. Not a release. |

There is no floating minor series on purpose: pinning means naming a version in
full. Do that once somebody other than you depends on the instance — `latest`
means the upgrade happens whenever you happen to pull, which is fine for a
laptop and not for a household.

Upgrading is then a pull rather than a build:

```bash
git pull
docker compose pull
docker compose up -d
```

`git pull` still earns its place — it is what brings a new compose file, new
bootstrap questions and this guide up to date — but it no longer decides which
code runs. Everything under [Upgrading](#upgrading) still applies: migrations
come from the image's entrypoint either way.

Neither choice is a commitment. An instance can move from building to pulling
and back at any time; the volumes, the database and `.env` do not care which
of the two put the container there.

---

## Running on a domain

Balancia expects to sit behind a reverse proxy that terminates TLS. HTTPS is not
optional in practice: **browsers refuse WebAuthn (passkeys) on plain HTTP**
outside localhost, so without TLS the passkey features simply cannot work.

### The settings that matter

Create `.env` next to `compose.yaml`:

```bash
# The URL people type. Must match exactly, including scheme.
APP_URL=https://balancia.example.com

# Optional: only when passkeys should span subdomains.
# WEBAUTHN_RP_ID=example.com

# Optional: additional origins allowed to call the app.
# TRUSTED_ORIGINS=https://alt.example.com

# Optional: email verification and password recovery.
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=balancia
# SMTP_PASSWORD=…
# SMTP_FROM=balancia@example.com

# Optional: receipts in S3-compatible storage instead of a local volume.
# STORAGE_DRIVER=s3
# S3_BUCKET=balancia-receipts
# S3_REGION=eu-west-1
# S3_ENDPOINT=https://s3.example.com
# S3_ACCESS_KEY_ID=…
# S3_SECRET_ACCESS_KEY=…
# S3_FORCE_PATH_STYLE=true

# Optional: cap on receipt uploads, in bytes. Default 10 MiB.
# UPLOAD_MAX_BYTES=10485760

# Optional: close sign-ups on a private instance.
# ALLOW_REGISTRATION=false

# Optional: Sign in with Apple. See the walkthrough below.
# APPLE_CLIENT_ID=com.example.balancia.web
# APPLE_TEAM_ID=A1B2C3D4E5
# APPLE_KEY_ID=ABC1234567
# APPLE_PRIVATE_KEY=
```

Full details in [environment.md](environment.md).

### Only bind to localhost when proxied

If the proxy runs on the same host, do not publish Balancia on `0.0.0.0`. Add a
`compose.override.yaml`:

```yaml
services:
  app:
    ports:
      - "127.0.0.1:3000:3000"
```

### The proxy must forward these headers

Whichever proxy you use, it has to pass:

- `X-Forwarded-Proto: https` — so Balancia knows the request was secure
- `X-Forwarded-For` — the client IP, which rate limiting depends on
- `Host` — matching `APP_URL`'s host, which WebAuthn depends on

Getting `X-Forwarded-For` wrong means every request looks like it comes from the
proxy, and rate limits then apply to all your users collectively.

### Caddy

Caddy gets certificates automatically and sets the forwarded headers by default:

```caddyfile
balancia.example.com {
    reverse_proxy localhost:3000
}
```

That is the entire configuration.

### Traefik

```yaml
services:
  app:
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.balancia.rule=Host(`balancia.example.com`)"
      - "traefik.http.routers.balancia.entrypoints=websecure"
      - "traefik.http.routers.balancia.tls.certresolver=letsencrypt"
      - "traefik.http.services.balancia.loadbalancer.server.port=3000"
    networks:
      - traefik
      - default
```

Traefik sets the forwarded headers itself. Make sure the container is on the
Traefik network and remove the `ports:` mapping.

### nginx

```nginx
server {
    listen 443 ssl http2;
    server_name balancia.example.com;

    ssl_certificate     /etc/letsencrypt/live/balancia.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/balancia.example.com/privkey.pem;

    # Receipt uploads; keep this at or above UPLOAD_MAX_BYTES.
    client_max_body_size 12M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade           $http_upgrade;
        proxy_set_header Connection        "upgrade";
    }
}
```

Any other proxy works too. Balancia has no proxy-specific behaviour — it only
reads standard forwarded headers.

### Leave `/.well-known/` alone

Balancia serves `/.well-known/apple-app-site-association` itself. That file is
what lets the iOS app open this instance's invitation links, and a proxy that
claims the whole `/.well-known/` prefix for certificate challenges will shadow
it — the app then silently keeps opening links in Safari, with no error on the
device and nothing in any log to explain it.

If your proxy has a rule for ACME challenges, narrow it to the path ACME
actually uses:

```nginx
# Not `location /.well-known/`.
location /.well-known/acme-challenge/ {
    root /var/www/certbot;
}
```

Caddy and Traefik handle their own challenges internally and need no such rule.
Check it from outside the host — a `200` and `content-type: application/json`,
with no redirect in the chain:

```bash
curl -sS -D - -o /dev/null https://balancia.example.com/.well-known/apple-app-site-association
```

---

## Sign in with Apple

Optional, and the one feature here with a prerequisite Balancia cannot supply:
a **paid Apple Developer Program membership** (currently $99/year). Apple issues
the credentials below only to enrolled accounts, so there is no way to offer
this button without one. Everything else in Balancia works without it, and
people who prefer a password or a passkey never touch Apple at all.

You also need a public HTTPS hostname — the one from `APP_URL`. Apple will not
redirect back to `http://` or to `localhost`.

### In the Apple Developer portal

Four things, in this order. All of them are under
[Certificates, Identifiers & Profiles](https://developer.apple.com/account/resources).

1. **An App ID.** _Identifiers → + → App IDs → App._ Give it any bundle ID you
   like (`com.example.balancia`), and enable the **Sign in with Apple**
   capability. Nothing is shipped to the App Store; this exists because Apple
   requires a Services ID to be grouped under one.

2. **A Services ID.** _Identifiers → + → Services IDs._ The identifier you
   choose here is your `APPLE_CLIENT_ID` — conventionally the App ID with a
   suffix, e.g. `com.example.balancia.web`. Enable **Sign in with Apple**,
   press **Configure**, and set:

   - **Primary App ID**: the App ID from step 1.
   - **Domains and Subdomains**: `balancia.example.com` — the host only, no
     scheme and no path.
   - **Return URLs**: `https://balancia.example.com/api/auth/apple/callback` —
     the full URL, and it must match byte for byte. A missing or extra trailing
     slash is the single most common cause of `invalid_client`.

3. **A key.** _Keys → + →_ tick **Sign in with Apple**, configure it against
   the same primary App ID, and register it. Apple lets you download the `.p8`
   **once** — if you lose it, revoke the key and make another. The key's ID is
   your `APPLE_KEY_ID`.

4. **Your team ID.** Top right of the developer portal, or under Membership.
   Ten characters; this is `APPLE_TEAM_ID`.

### In `.env`

```bash
APPLE_CLIENT_ID=com.example.balancia.web
APPLE_TEAM_ID=A1B2C3D4E5
APPLE_KEY_ID=ABC1234567
APPLE_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' AuthKey_ABC1234567.p8)"
```

The `awk` is not decoration: the `.p8` is a multi-line PEM block, and a `.env`
line cannot hold real newlines. Balancia turns the `\n` back into newlines when
it reads the value. Then:

```bash
docker compose up -d
```

The button appears on the sign-in and register pages. If the four values are
incomplete or malformed, the app says so at startup rather than at the redirect.

### Afterwards

- **Hidden addresses.** People who choose "Hide My Email" arrive with an
  `@privaterelay.appleid.com` forwarder, which Balancia treats like any other
  address. If you have SMTP configured with a `SMTP_FROM` at a domain Apple
  does not know, register that domain with Apple as a
  [private email relay source](https://developer.apple.com/help/account/configure-app-capabilities/configure-private-email-relay-service),
  or Apple will silently drop mail to those forwarders.

- **Existing accounts are not claimed automatically.** If somebody already has
  a Balancia account with the same address, Apple sign-in links to it only when
  both Apple and this instance have verified that address. Otherwise they are
  asked to sign in as they already do and link Apple from _Profile → Passkeys &
  security_. On an instance with no SMTP nothing is ever verified locally, so
  that deliberate path is always the one taken. The reasoning is in
  [environment.md](environment.md#sign-in-with-apple-optional).

- **Nobody gets locked out.** An account whose only credential is Apple cannot
  unlink it; Balancia asks for a password or a passkey first.

- **Turning it off.** Unset the four variables and restart. Accounts created
  through Apple keep working — but if one has no password and no passkey, it
  has no way in, so give people warning.

### Trying it before you commit

Apple will not redirect to localhost, so the dev stack has `DEV_APP_URL` for
pointing at a tunnel:

```bash
DEV_APP_URL=https://something.trycloudflare.com \
DEV_APPLE_CLIENT_ID=com.example.balancia.web \
DEV_APPLE_TEAM_ID=A1B2C3D4E5 \
DEV_APPLE_KEY_ID=ABC1234567 \
DEV_APPLE_PRIVATE_KEY="$(awk '{printf "%s\\n", $0}' AuthKey_ABC1234567.p8)" \
  pnpm dev:docker
```

Register the tunnel hostname and its callback URL with the Services ID first,
the same as a real domain.

---

## Background jobs

Recurring expenses, import commits, push delivery, exchange-rate refreshes and
the nightly housekeeping sweep are queued in PostgreSQL through pg-boss. **The
app container runs them itself**, which is why the default stack has no third
service, and why the image works on its own behind a reverse proxy with no
Compose file at all.

Nothing needs configuring for this. `RUN_WORKER_IN_WEB` defaults to `true`, and
the app logs `Background worker is running inside the web process` on startup.
If it cannot reach the queue it says so loudly and carries on serving pages — a
queue that is down must not take the app with it — so that line's absence from
the log is the thing to look for when a recurring expense fails to appear.

### Giving the jobs their own container

Worth doing when a job is heavy enough to be felt in request latency: a large
import commit, server-side receipt reading on a small machine, or anything
where you would rather restart the web container without waiting for in-flight
work to drain. It costs about 128–256 MB of RAM.

Two lines in `.env`, and they move together:

```
COMPOSE_PROFILES=worker
RUN_WORKER_IN_WEB=false
```

Then `docker compose up -d --build` starts three containers. The worker runs
the same image and the same code — `src/worker/run.ts` holds the subscriptions
and both shapes load it, so a queue is never served by one and not the other —
and it gets a 40s grace period on shutdown to finish what it has in hand.

Setting one line without the other is the mistake to avoid, and neither half
fails loudly on its own:

| `COMPOSE_PROFILES` | `RUN_WORKER_IN_WEB` | What happens                                                                                                                          |
| ------------------ | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| unset              | `true` _(default)_  | The app runs the jobs. The intended default.                                                                                          |
| `worker`           | `false`             | The worker container runs the jobs. The intended alternative.                                                                         |
| `worker`           | `true`              | Both subscribe. pg-boss gives each job to one of them, so nothing breaks and nothing is gained; the worker warns about it at startup. |
| unset              | `false`             | **Nothing runs the jobs.** Pages serve normally, and no recurring expense is generated, no push delivered, nothing pruned.            |

`./scripts/bootstrap.sh` checks this pair on every run and offers to repair
either mismatch, so it is worth running again after editing `.env` by hand.

### Coming from a stack that had a worker container

Instances set up before this became the default ran `app` and `worker` with
`RUN_WORKER_IN_WEB` unset. After pulling, that unset value means `true`, so
either keep the split by writing both lines above, or take the default and
clear away the container that is no longer part of the stack:

```bash
docker compose up -d --build --remove-orphans
```

---

## Health checks

| Endpoint                | Meaning                                                                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/health/live`  | The process is up and serving. Does **not** touch the database — a database outage should not cause your orchestrator to restart a healthy web process. |
| `GET /api/health/ready` | The process can serve real traffic: PostgreSQL answers and migrations have been applied. Returns 503 until then.                                        |

Compose already wires these. For an external monitor, watch `/api/health/ready`.

---

## Upgrading

```bash
git pull
docker compose up -d --build
```

On an instance running the published image, that is a `pull` instead — see
[Running the published image](#running-the-published-image).

What happens, in order:

1. New images build.
2. `app` restarts, and `worker` with it where the jobs have their own
   container. Each applies any new SQL migrations first — one transaction per
   migration, guarded by a PostgreSQL advisory lock, so two containers cannot
   race.
3. Nothing is served until those migrations succeed. If they fail, the
   container exits with the error and Compose restarts it; `docker compose logs
app` shows what went wrong.

**Migrations are forward-only and never destructive without warning.** Applied
migrations are recorded with a checksum; if a file that has already run is
edited, startup fails loudly rather than applying a changed migration silently.

**Take a backup before upgrading.** See
[backup-and-restore.md](backup-and-restore.md) — it takes seconds and it is the
difference between a bad upgrade being an inconvenience and a disaster.

### Upgrading over SSH

`scripts/deploy.sh` runs those same commands on a remote host, and is meant to
be run from a laptop rather than on the server:

```bash
./scripts/deploy.sh
```

It pushes nothing. The server pulls from origin, so a deploy ships what is
merged, and starting one from a feature branch is harmless.

Before it changes anything, it checks in a single round trip that the path is a
checkout with a `compose.yaml` and a `.env`, that `docker compose` is available
to that user, that the branch is not detached and tracks an upstream, and that
the working tree is clean. Then it fetches and prints the commits that are
about to land. `--dry-run` stops exactly there.

The pull is `--ff-only`. A deploy host that cannot fast-forward has commits of
its own, and merging them silently is how a server ends up running something no
branch describes; it stops and asks for a person instead. It then pulls the
app's image with `--ignore-buildable`, which is a no-op where the host builds
its own and the whole point where it does not: `up --build` has nothing to
build there, and would otherwise restart the code the server was already
running. Afterwards it polls
`docker compose ps` until every service is running — and healthy, for the two
that have a healthcheck — so a zero exit status means the containers actually
came back, not merely that Compose accepted the command.

| Flag / variable                         | Default       | What it picks              |
| --------------------------------------- | ------------- | -------------------------- |
| `-H`, `--host` / `BALANCIA_DEPLOY_HOST` | `ecom-debian` | ssh alias, or `user@host`  |
| `-C`, `--path` / `BALANCIA_DEPLOY_PATH` | `balancia`    | the checkout on the server |
| `BALANCIA_DEPLOY_TIMEOUT`               | `180`         | seconds to wait on health  |

Host keys, users and jump hosts are all left to `~/.ssh/config`, which already
knows about them.

### The database volume moved (one-time change)

`compose.yaml` used to mount the `balancia-db-data` volume at
`/var/lib/postgresql/data`. It now mounts it one level up, at
`/var/lib/postgresql`, and PostgreSQL keeps the cluster in a version-specific
subdirectory beneath it (`/var/lib/postgresql/18/docker`).

This was not a preference. From PostgreSQL 18 on, the official images refuse to
start when anything is mounted at the old path, exiting with
`there appears to be PostgreSQL data in: /var/lib/postgresql/data (unused
mount/volume)`. They do this even when the volume is completely empty, so the
old configuration could not start a database at all.

**Almost certainly, you have nothing to do.** Every version of `compose.yaml`
that shipped with the old mount path also specified PostgreSQL 18, so
`docker compose up` failed before the database ever initialised. If that is what
you hit, just pull and start it — there is no data in the volume to preserve:

```bash
git pull
docker compose up -d --build
```

**If you worked around the failure by pinning an older PostgreSQL** (editing
`db.image` to `postgres:17-alpine` or similar), you have a real cluster, and it
sits at the root of the volume where the new mount does not look for it. Moving
the directory is not sufficient — PostgreSQL 18 cannot open a version 17 data
directory in place; a major-version change needs `pg_upgrade` or a dump and
restore. Dump and restore is the shorter path here:

```bash
# 1. With your stack still on the OLD image and OLD mount path, dump the data.
docker compose exec -T db \
  pg_dump -U balancia -d balancia --format=custom --no-owner > balancia.dump

# 2. Take a full backup as well, before destroying anything.
./balancia-backup.sh /var/backups/balancia

# 3. Stop the stack and delete ONLY the database volume. Note this is `down`
#    without `-v`: the uploads volume must survive. Leave .env alone too — the
#    new cluster initialises with the POSTGRES_PASSWORD held in it.
docker compose down
docker volume rm balancia-db-data

# 4. Take the new configuration and bring up the database on its own. It
#    initialises an empty cluster at the new path.
git pull
docker compose up -d db
until docker compose exec -T db pg_isready -U balancia -d balancia; do sleep 2; done

# 5. Load the dump, then start everything.
docker compose exec -T db \
  pg_restore -U balancia -d balancia --clean --if-exists --no-owner < balancia.dump
docker compose up -d --build
```

If `docker volume rm` reports the volume is still in use, a container is still
attached — `docker compose down --remove-orphans` and retry. Do not reach for
`docker compose down -v` to force it: that deletes the receipts along with the
database.

Then verify as described in
[backup-and-restore.md](backup-and-restore.md#verifying-the-restore) — at
minimum, `curl -fsS http://localhost:3000/api/health/ready` and a row count.
Keep `balancia.dump` until you have confirmed the data is there.

### Rolling back

Balancia does not ship down-migrations: for financial data, a scripted rollback
that drops a column is more dangerous than a restore. To go back:

1. Stop the stack: `docker compose down`
2. Restore the database from your pre-upgrade dump.
3. Check out the previous tag and `docker compose up -d --build`.

---

## Resource expectations

For a household or a group of friends:

- **PostgreSQL**: ~256 MB RAM is plenty.
- **App**: ~256–512 MB RAM, background jobs included.
- **Worker**: ~128–256 MB RAM, and only if you gave the jobs their own
  container — see [Background jobs](#background-jobs).
- **Disk**: the database stays small (text and integers). Receipts dominate —
  budget for how many photos you expect.

One caveat on memory: password hashing uses scrypt with deliberately expensive
parameters (~128 MB per hash, briefly). A host with very little RAM may struggle
under concurrent sign-ins. This is a security feature, not an accident.

Both `linux/amd64` and `linux/arm64` are supported, so a Raspberry Pi 4/5 or an
ARM VPS works.

---

## Operating notes

**Logs** are newline-delimited JSON in production:

```bash
docker compose logs -f app
docker compose logs -f app   # or `worker`, where the jobs have their own container
```

Secrets, tokens and passwords are redacted before anything is written.

**The database is deliberately not exposed.** To inspect it:

```bash
docker compose exec db psql -U balancia -d balancia
```

**No telemetry by default.** A stock installation contacts no external service
at runtime: no analytics, no error reporting, no update check. An administrator
may opt in, in Settings → Administration → Telemetry, to one anonymous report a
week — the version, which features are on, and activity in ranges rather than
counts, with no identifier for this installation and nothing about anyone using
it. Both that switch and the separate crash-report switch start off, the exact
payload is previewable before anything is sent, and

```bash
TELEMETRY_MODE=off
```

takes the decision away from the UI entirely. Full detail, including the
complete field list and what is deliberately not collected:
[Telemetry](telemetry.md).

**Metrics, if you want them.** `METRICS_ENABLED=true` exposes Prometheus text at
`/api/metrics` for your own monitoring: request and job durations, error rates,
database latency and pool usage, memory and CPU. Exact, local, and never
transmitted by Balancia. Set `METRICS_TOKEN` unless the published port is on a
private network.

**Stopping cleanly:**

```bash
docker compose down          # keeps volumes and data
docker compose down -v       # DELETES all data, including receipts
```
