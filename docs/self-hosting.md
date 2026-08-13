# Self-hosting Balancia

Balancia is designed to be run by one person for a handful of people, on modest
hardware, with as few moving parts as possible: an app container, a worker
container, and PostgreSQL. No Redis, no message broker, no external services.

## Quick start

```bash
git clone https://github.com/your-org/balancia.git
cd balancia
docker compose up -d --build
```

Open <http://localhost:3000> and create the first account.

### What that command sets up

| Service        | Role                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `init-secrets` | Generates the database password and instance secret on first run, into a named volume. Idempotent — later starts reuse them. |
| `db`           | PostgreSQL 18. **Not published to the host**; reachable only on the internal Compose network.                                |
| `migrate`      | Applies committed SQL migrations, then exits. App and worker wait for it to finish.                                          |
| `app`          | The web application. Published on `${APP_PORT:-3000}`.                                                                       |
| `worker`       | Background jobs: recurring expenses, import commits, housekeeping.                                                           |

Three named volumes hold everything that matters:

| Volume             | Contents                                            |
| ------------------ | --------------------------------------------------- |
| `balancia-db-data` | The PostgreSQL database                             |
| `balancia-uploads` | Receipt files                                       |
| `balancia-secrets` | The generated database password and instance secret |

### About the generated secrets

Nothing in this repository contains a usable production secret. On first run,
`init-secrets` writes two random values into the `balancia-secrets` volume:

- `auth_secret` — 48 random bytes, base64
- `postgres_password` — 40 random alphanumeric characters

They persist across restarts and upgrades, so sessions survive. **Back up that
volume**: losing `auth_secret` signs everyone out; losing
`postgres_password` locks you out of your own database.

To manage them yourself instead, put them in `.env`:

```bash
AUTH_SECRET=$(openssl rand -base64 48)
POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -dc 'A-Za-z0-9' | head -c 40)
```

Values in `.env` win; the bootstrap writes them into the volume and stops
generating its own.

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
2. `migrate` runs to completion, applying any new SQL migrations inside a
   transaction each, guarded by a PostgreSQL advisory lock so concurrent
   containers cannot race.
3. `app` and `worker` start only after migrations succeed.

**Migrations are forward-only and never destructive without warning.** Applied
migrations are recorded with a checksum; if a file that has already run is
edited, startup fails loudly rather than applying a changed migration silently.

**Take a backup before upgrading.** See
[backup-and-restore.md](backup-and-restore.md) — it takes seconds and it is the
difference between a bad upgrade being an inconvenience and a disaster.

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
