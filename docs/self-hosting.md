# Self-hosting Balancia

Balancia is designed to be run by one person for a handful of people, on modest
hardware, with as few moving parts as possible: an app container, a worker
container, and PostgreSQL. No Redis, no message broker, no external services.

## Quick start

```bash
git clone https://github.com/your-org/balancia.git
cd balancia
./scripts/bootstrap.sh
docker compose up -d --build
```

Open <http://localhost:3000> and create the first account.

### What those commands set up

`bootstrap.sh` writes a `.env` holding this instance's own secrets. It needs
only a POSIX shell and `/dev/urandom`, and it never overwrites a value that is
already set — so re-running it is a no-op, and `./scripts/bootstrap.sh &&
docker compose up -d` is a safe habit.

Run from a terminal, it also asks which optional features to switch on:

| Question              | Writes                    | Also does                      |
| --------------------- | ------------------------- | ------------------------------ |
| Public URL            | `APP_URL`, `APP_PORT`     | Rejects HTTP outside localhost |
| Open registration     | `ALLOW_REGISTRATION`      |                                |
| Exchange rates        | `EXCHANGE_RATE_PROVIDER`  |                                |
| Receipt scanning      | `RECEIPT_SCANNING`        | Downloads the OCR models       |
| Semantic categorizing | `SEMANTIC_CATEGORIZATION` | Downloads the embedding model  |
| Push notifications    | `PUSH_VAPID_*`            | Generates the VAPID pair       |
| Outgoing email        | `SMTP_*`                  |                                |

Every answer is written, including the no's, so the second run asks nothing.
The two model downloads need Node; on a host that has only Docker, one is
borrowed from a throwaway `node:24-alpine` container for the length of the
download. If neither is there, the flag is still written and the script says
which command to run.

That is a deliberate pairing: a feature switched on whose model files are
missing renders no button and explains nothing, so the script that writes the
flag is the one that fetches the files. It re-checks on every run, in case a
download failed after the flag was written.

Nothing has to be answered interactively. With no terminal on stdin — CI, a
pipe — or with `--defaults`, it writes the secrets and leaves every optional
feature at its documented default.

Compose then starts three services:

| Service  | Role                                                                                          |
| -------- | --------------------------------------------------------------------------------------------- |
| `db`     | PostgreSQL 18. **Not published to the host**; reachable only on the internal Compose network. |
| `app`    | The web application. Published on `${APP_PORT:-3000}`.                                        |
| `worker` | Background jobs: recurring expenses, import commits, housekeeping.                            |

Migrations are not a separate service. The image's entrypoint applies any
pending ones before `app` and `worker` start, on every boot. Both doing it at
once is safe — the runner takes a PostgreSQL advisory lock, so the second waits
and then finds the schema already current. To take that over yourself, set
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

What happens, in order:

1. New images build.
2. `app` and `worker` restart. Each applies any new SQL migrations first — one
   transaction per migration, guarded by a PostgreSQL advisory lock so the two
   containers cannot race.
3. Neither serves anything until its migrations succeed. If they fail, the
   container exits with the error and Compose restarts it; `docker compose logs
app` shows what went wrong.

**Migrations are forward-only and never destructive without warning.** Applied
migrations are recorded with a checksum; if a file that has already run is
edited, startup fails loudly rather than applying a changed migration silently.

**Take a backup before upgrading.** See
[backup-and-restore.md](backup-and-restore.md) — it takes seconds and it is the
difference between a bad upgrade being an inconvenience and a disaster.

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
- **App**: ~256–512 MB RAM.
- **Worker**: ~128–256 MB RAM.
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
docker compose logs -f worker
```

Secrets, tokens and passwords are redacted before anything is written.

**The database is deliberately not exposed.** To inspect it:

```bash
docker compose exec db psql -U balancia -d balancia
```

**No telemetry.** Balancia contacts no external service at runtime. There is no
analytics, no error reporting, no update check.

**Stopping cleanly:**

```bash
docker compose down          # keeps volumes and data
docker compose down -v       # DELETES all data, including receipts
```
