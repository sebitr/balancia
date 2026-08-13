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

```bash
#!/usr/bin/env bash
# balancia-backup.sh — run from the directory containing compose.yaml
set -euo pipefail

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${1:-./backups}/${STAMP}"
mkdir -p "$DEST"

echo "Backing up to $DEST"

# 1. Database — a custom-format dump, compressed and restorable selectively.
docker compose exec -T db \
  pg_dump -U balancia -d balancia --format=custom --no-owner \
  > "$DEST/balancia.dump"

# 2. Receipts.
docker run --rm \
  -v balancia-uploads:/data:ro \
  -v "$(realpath "$DEST")":/backup \
  alpine:3.21 tar czf /backup/uploads.tar.gz -C /data .

# 3. Secrets and configuration — one file, and the only copy of both.
cp .env "$DEST/env"

chmod -R go-rwx "$DEST"
echo "Done. $(du -sh "$DEST" | cut -f1)"
```

```bash
chmod +x balancia-backup.sh
./balancia-backup.sh /var/backups/balancia
```

`env` contains live credentials. Store the backup somewhere only you can read,
and encrypt it if it leaves the machine:

```bash
tar czf - -C /var/backups/balancia "$STAMP" \
  | age -r age1yourpublickey... > "balancia-${STAMP}.tar.gz.age"
```

### Automating it

```cron
# 03:30 daily, keep 30 days
30 3 * * * cd /srv/balancia && ./balancia-backup.sh /var/backups/balancia >> /var/log/balancia-backup.log 2>&1
15 4 * * * find /var/backups/balancia -maxdepth 1 -type d -mtime +30 -exec rm -rf {} +
```

### Backing up without stopping the service

`pg_dump` takes a consistent snapshot of a running database, so no downtime is
needed for the database. Receipts are written once and never modified, so a
`tar` of the volume during normal operation is safe — at worst it misses a file
uploaded in the same second, which the next run picks up.

For a guaranteed-consistent point-in-time copy, stop the app and worker (leaving
the database up for `pg_dump`):

```bash
docker compose stop app worker
./balancia-backup.sh
docker compose start app worker
```

---

## Restoring

### Onto a clean host

```bash
# 1. Get the code and pick the version the backup came from.
git clone https://github.com/your-org/balancia.git && cd balancia
git checkout v1.2.3

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
      docker compose exec -T app test -f "/data/uploads/$key" \
        || echo "MISSING: $key"
    done
```

Then sign in and open a group. Balances are derived, not stored, so if they
render at all the underlying data is intact — and the balance engine refuses to
display figures that do not sum to zero, which makes it a restore check in
itself.

---

## Restoring only part of it

**Just the receipts** (database is fine):

```bash
docker compose stop app worker
docker run --rm -v balancia-uploads:/data -v /path/to/backup:/backup:ro \
  alpine:3.21 sh -c "rm -rf /data/* && tar xzf /backup/uploads.tar.gz -C /data"
docker compose start app worker
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

A backup you have never restored is a hypothesis. Once a quarter, restore into a
throwaway stack and check it:

```bash
mkdir /tmp/balancia-drill && cd /tmp/balancia-drill
git clone https://github.com/your-org/balancia.git .
# follow the restore steps above, but with a distinct project name:
docker compose -p balancia-drill up -d --build
curl -fsS http://localhost:3001/api/health/ready
docker compose -p balancia-drill down -v
```

Using `-p balancia-drill` keeps the drill's volumes separate from production, so
a mistake during the rehearsal cannot touch real data.
