# Backup and restore

Balancia holds financial history that cannot be reconstructed from anywhere
else. Three things must be backed up together, and a backup missing any one of
them is not a backup you can restore from.

| What         | Where                                         | Lose it and…                                                                                         |
| ------------ | --------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Database** | `balancia-db-data` volume                     | Everything is gone: groups, expenses, balances, history.                                             |
| **Receipts** | `balancia-uploads` volume (or your S3 bucket) | Expenses survive, but every attached receipt is a broken link.                                       |
| **Secrets**  | the `.env` file next to `compose.yaml`        | Everyone is signed out (`AUTH_SECRET`), and you cannot open your own database (`POSTGRES_PASSWORD`). |

They must be captured at roughly the same time. A database dump from Tuesday
next to receipts from Friday will reference files that the dump does not know
about, and vice versa.

### Why the database is dumped and the other two are tarred

Receipts are ordinary files, so a `tar` of the volume is a faithful copy, and
the secrets are a single `.env` to copy. The database is not: a file-level copy of a running cluster is a torn
copy, and even a clean one is tied to the exact PostgreSQL major version and
platform that wrote it.

`balancia-db-data` is mounted at `/var/lib/postgresql`, and PostgreSQL stores
the cluster in a version-specific subdirectory beneath it —
`/var/lib/postgresql/18/docker`. That layout is an implementation detail of the
image, and it has changed before (see
[the volume layout note in self-hosting.md](self-hosting.md#the-database-volume-moved-one-time-change)).
`pg_dump` output does not depend on any of it, which is what makes it restorable
onto a different host, a different architecture, or a later PostgreSQL. Back up
the database with `pg_dump`, never with `tar`.

---

## Backing up

### The whole thing, in one script

`scripts/backup.sh` takes all three at once. A standalone install has it
beside `compose.yaml`, and a checkout has it under `scripts/`; the examples on
this page use the checkout's path, so drop the `scripts/` on a standalone
install.

```bash
./backup.sh /var/backups/balancia             # standalone install
./scripts/backup.sh /var/backups/balancia     # checkout
```

A standalone install made before the script shipped fetches it once, into the
directory holding `compose.yaml`:

```bash
curl -fsSLO https://raw.githubusercontent.com/sebitr/balancia/main/scripts/backup.sh
chmod +x backup.sh
```

It finds the installation from where it sits rather than from where it was
started, so it can be run from anywhere. Each run writes one directory, named
for the moment it was taken, in UTC:

```
/var/backups/balancia/20260929T033000Z/
  balancia.dump     the database, a pg_dump custom-format archive
  uploads.tar.gz    the receipts volume
  env               a copy of .env
```

In order, it:

1. **Dumps the database** with `pg_dump --format=custom` inside the `db`
   container. The host needs no PostgreSQL client, and the dump is always
   written by the same major version that holds the data. It then reads the
   dump back with `pg_restore --list` through the same container, so an empty
   file, or an error message where the archive should be, fails the run.
2. **Archives the receipts**: a `tar` of the `balancia-uploads` volume, mounted
   read-only into a throwaway `alpine` container. With `STORAGE_DRIVER=s3`
   there is no volume to archive, and it says so and carries on — the bucket
   needs [a backup of its own](#if-you-use-s3-for-receipts).
3. **Copies `.env`**, the only copy of the secrets there is.

Everything is written under `umask 077`, so nobody else on the host can read
any of it. Anything that fails stops the run with a non-zero exit status and
removes the half-written directory: a backup missing a part is not one you can
restore from, and leaving it beside the good ones is how it gets restored from
anyway. Without a destination it writes to `backups/` beside `compose.yaml`,
which git and the Docker build both ignore.

Progress goes to standard error. The one line on standard output is the
directory it wrote, which is what makes it easy to hand on to the next command.

`env` contains live credentials. Store the backup somewhere only you can read,
and encrypt it if it leaves the machine:

```bash
dir=$(./scripts/backup.sh /var/backups/balancia)
tar czf - -C "$(dirname "$dir")" "$(basename "$dir")" \
  | age -r age1yourpublickey... > "balancia-$(basename "$dir").tar.gz.age"
```

### Automating it

`--keep N` deletes all but the newest N backups in the destination. It runs
only once the new backup is safely written, so a failing night never leaves
fewer good backups than it found, and it only ever counts directories whose
names it wrote itself — anything else you keep there is left alone.

```cron
# 03:30 daily, keep 30
30 3 * * * cd /srv/balancia && ./scripts/backup.sh --keep 30 /var/backups/balancia >> /var/log/balancia-backup.log 2>&1
```

### Before an upgrade

`--database-only` writes the dump and nothing else. That is the restore point
an upgrade needs — migrations change the schema, never the receipts or `.env`
— and it is what [`scripts/deploy.sh`](self-hosting.md#upgrading-over-ssh)
takes before every deploy. By hand, before `docker compose pull`:

```bash
./scripts/backup.sh --database-only --keep 10 backups/pre-upgrade
```

It prints the command that restores it. Going back is
[Rolling back](self-hosting.md#rolling-back) in the self-hosting guide.

### Backing up without stopping the service

`pg_dump` takes a consistent snapshot of a running database, so no downtime is
needed for the database. Receipts are written once and never modified, so a
`tar` of the volume during normal operation is safe — at worst it misses a file
uploaded in the same second, which the next run picks up.

For a guaranteed-consistent point-in-time copy, stop the app (leaving the
database up for `pg_dump`):

```bash
docker compose stop app
./scripts/backup.sh
docker compose start app
```

Add `worker` to both commands if you gave the background jobs
[their own container](self-hosting.md#background-jobs); without that profile
enabled, naming a service Compose is not running is an error.

---

## Restoring

### Onto a clean host

```bash
# 1. Get the code at the version the backup came from. --branch takes a tag,
#    so the shallow copy lands on it directly; a plain --depth 1 clone carries
#    no tags to check out afterwards.
git clone --depth 1 --branch v1.2.3 https://github.com/sebitr/balancia.git && cd balancia

# 2. Restore secrets and configuration FIRST — the database container
#    initialises with POSTGRES_PASSWORD from this file, and only ever does so
#    once. Do NOT run bootstrap.sh here: a fresh password would not match the
#    one the restored dump's cluster was created with.
cp /path/to/backup/env .env

# 3. Start only the database and let it initialise.
docker compose up -d db
until docker compose exec -T db pg_isready -U balancia -d balancia; do sleep 2; done

# 4. Restore the database.
docker compose exec -T db \
  pg_restore -U balancia -d balancia --clean --if-exists --no-owner \
  < /path/to/backup/balancia.dump

# 5. Restore receipts.
docker volume create balancia-uploads
docker run --rm -v balancia-uploads:/data \
  -v /path/to/backup:/backup:ro \
  alpine:3.21 tar xzf /backup/uploads.tar.gz -C /data

# 6. Bring everything up. Migrations run and become a no-op if the dump is
#    already current, or apply cleanly if you restored an older schema.
docker compose up -d --build
```

### Verifying the restore

Do not assume it worked — check:

```bash
# Readiness must report ok, with migrations applied.
curl -fsS http://localhost:3000/api/health/ready

# Row counts should match what you expect.
docker compose exec -T db psql -U balancia -d balancia -c \
  "SELECT (SELECT count(*) FROM groups)   AS groups,
          (SELECT count(*) FROM expenses) AS expenses,
          (SELECT count(*) FROM users)    AS users;"

# Every receipt row should have a file behind it.
docker compose exec -T db psql -U balancia -d balancia -tAc \
  "SELECT storage_key FROM attachments WHERE deleted_at IS NULL" \
  | while read -r key; do
      docker compose exec -T app test -f "/data/uploads/$key" < /dev/null \
        || echo "MISSING: $key"
    done
```

The `< /dev/null` matters: `exec` forwards its standard input to the container
whether or not anything there reads it, and without it the first check would
swallow every key after its own and the loop would end there, reporting
nothing missing.

Then sign in and open a group. Balances are derived, not stored, so if they
render at all the underlying data is intact — and the balance engine refuses to
display figures that do not sum to zero, which makes it a restore check in
itself.

---

## Restoring only part of it

**Just the receipts** (database is fine):

```bash
docker compose stop app
docker run --rm -v balancia-uploads:/data -v /path/to/backup:/backup:ro \
  alpine:3.21 sh -c "rm -rf /data/* && tar xzf /backup/uploads.tar.gz -C /data"
docker compose start app
```

**Just one group**, from a custom-format dump: `pg_restore` cannot filter by
row, so restore the whole dump into a scratch database and copy across:

```bash
docker compose exec -T db createdb -U balancia balancia_restore
docker compose exec -T db pg_restore -U balancia -d balancia_restore --no-owner \
  < /path/to/backup/balancia.dump
# then inspect balancia_restore and copy what you need with INSERT ... SELECT
```

---

## If you use S3 for receipts

With `STORAGE_DRIVER=s3` the `balancia-uploads` volume is unused; receipts live
in your bucket. Back that up separately — object versioning plus a lifecycle
rule, or a periodic sync:

```bash
aws s3 sync "s3://$S3_BUCKET" /var/backups/balancia/receipts --delete
```

The database still holds all receipt _metadata_, so a database restore without
the bucket leaves you with correct expenses and unreachable files.

---

## Testing your backups

A backup you have never restored is a hypothesis. Once a quarter, restore one
into a throwaway stack and check it.

**Run the drill on another machine if you can.** A laptop with Docker is
enough, and nothing on it can reach production's volumes, containers or ports,
so no slip in the steps below can cost you data. They are written to be safe
beside production on the same host as well — but only exactly as written.

### Why a project name is not enough

`compose.yaml` names its volumes and containers outright — `balancia-db-data`,
`balancia-uploads`, `balancia-db`, `balancia-app`, `balancia-worker` — rather
than letting Compose derive them from the project name. That is what keeps an
existing install's data where it has always been, and it also means `-p`
changes none of them. `docker compose -p balancia-drill up`, which this page
used to recommend, either stops at a container-name conflict with production
or, with production taken down to make room, mounts production's own volumes,
restores the backup over them, and leaves them for the drill's `down -v` to
delete.

[`compose.drill.yaml`](../compose.drill.yaml) is what keeps the two apart. Laid
over `compose.yaml`, it gives the drill its own project, volumes, containers
and image tag; publishes the app on `127.0.0.1:3300` and the database not at
all; and takes the drill off everything production talks to — a
`DATABASE_URL` outside the stack, an S3 bucket, the mail server, the push keys
— because the restored database holds real people's addresses and push
subscriptions, and the drill runs the same background jobs production does. It
needs Compose 2.24.4 or newer; `docker compose version` says which you have.

### The drill

**Every `docker compose` command here carries
`-f compose.yaml -f compose.drill.yaml -p balancia-drill`.** In the drill's
checkout a bare `docker compose` means production: `compose.yaml` names its
project `balancia` wherever it is run from. That goes for the commands under
[Verifying the restore](#verifying-the-restore) too — typed as they are there,
they would check production and report the drill healthy.

```bash
# 1. A checkout at the version the backup came from, and the backup's .env.
git clone --depth 1 --branch v1.2.3 https://github.com/sebitr/balancia.git /tmp/balancia-drill
cd /tmp/balancia-drill
cp /path/to/backup/env .env

# 2. The drill's image, tagged balancia-drill:local.
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill build

# 3. Its database on its own, then the dump.
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill up -d db
until docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill \
  exec -T db pg_isready -U balancia -d balancia; do sleep 2; done
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill \
  exec -T db pg_restore -U balancia -d balancia --clean --if-exists --no-owner \
  < /path/to/backup/balancia.dump

# 4. Receipts, into the drill's own volume. As root, because the backup
#    script leaves the archive readable by its owner alone.
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill \
  run --rm --no-deps --user root -v /path/to/backup:/backup:ro \
  --entrypoint tar app xzf /backup/uploads.tar.gz -C /data/uploads

# 5. The rest of the stack, and the checks.
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill up -d --wait
curl -fsS http://localhost:3300/api/health/ready
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill \
  exec -T db psql -U balancia -d balancia -c \
  "SELECT (SELECT count(*) FROM groups)   AS groups,
          (SELECT count(*) FROM expenses) AS expenses,
          (SELECT count(*) FROM users)    AS users;"
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill \
  exec -T db psql -U balancia -d balancia -tAc \
  "SELECT storage_key FROM attachments WHERE deleted_at IS NULL" \
  | while read -r key; do
      docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill \
        exec -T app test -f "/data/uploads/$key" < /dev/null \
        || echo "MISSING: $key"
    done
```

Then open <http://localhost:3300> — through
`ssh -L 3300:127.0.0.1:3300 you@host` if the drill is on a server — sign in,
and open a group. Passkeys and Sign in with Apple are tied to production's
address and will not work here; a password will.

A release older than the drill file has no `compose.drill.yaml` in its
checkout, and step 2 stops at the missing file. Take it from `main` — the
services and volumes it renames have been the same since 0.1.0:

```bash
curl -fsSLO https://raw.githubusercontent.com/sebitr/balancia/main/compose.drill.yaml
```

The drill builds its image from the checkout even where production pulls the
published one: naming files with `-f` takes the place of the `COMPOSE_FILE`
line in the restored `.env`. If something on the host already holds port 3300,
change it in `compose.drill.yaml` — the published port and `APP_URL` both — and
in the health check in step 5.

### Tearing it down

**This deletes volumes, so copy it exactly.** Leave out
`-f compose.drill.yaml` and the volumes `down -v` goes after are production's.
Leave out every flag and it removes production's containers first, so nothing
is left holding those volumes when it deletes them.

```bash
docker compose -f compose.yaml -f compose.drill.yaml -p balancia-drill down -v
docker image rm balancia-drill:local
rm -rf /tmp/balancia-drill
```

The last line is not tidiness: the checkout holds a copy of production's
`.env`, with its database password and its auth secret.
