# Balancia

**Shared expenses, fairly balanced — on a server you control.**

A free, privacy-first expense splitter for trips, households, couples,
families, clubs and teams. Exact splits, multiple currencies, receipts,
guests without accounts, and exports you can take elsewhere. No advertising,
no third-party runtime service, and telemetry off unless an administrator
turns it on.

This image is the whole application: the web app, the background worker and
the migration runner, picked by the command it is given. Source, issues and
the full documentation live at
[github.com/sebitr/balancia](https://github.com/sebitr/balancia).

## Tags

| Tag       | What it is                                                            |
| --------- | --------------------------------------------------------------------- |
| `latest`  | The newest release. Moves under you at every pull.                    |
| `0.1.0`   | That release, permanently. What to pin an instance you care about to. |
| `preview` | `main` as it is right now, rebuilt on every merge. Not a release.     |

Every tag is a manifest list covering **linux/amd64** and **linux/arm64**, so
`docker pull` serves the right one without being asked.

## Running it

Balancia needs a PostgreSQL database and a couple of secrets, so the shortest
honest quick start is Compose — it brings up PostgreSQL 18 alongside the app,
and the repository carries the setup script that points it at this image:

```bash
git clone https://github.com/sebitr/balancia.git
cd balancia
./scripts/bootstrap.sh
docker compose up -d
```

`bootstrap.sh` writes a `.env` with this instance's own database password and
auth secret, asks whether this host should pull this image or build one from
the checkout — pulling is the default — and asks which optional features to
switch on. It is safe to run again. Then open <http://localhost:3000> and
create the first account.

To run the container yourself against a database you already have:

```bash
docker run -d --name balancia \
  -p 3000:3000 \
  -v balancia-uploads:/data/uploads \
  -e APP_URL=https://balancia.example.com \
  -e DATABASE_URL=postgres://balancia:secret@db:5432/balancia \
  -e AUTH_SECRET="$(openssl rand -base64 48)" \
  sebitro/balancia:latest
```

**Back up `AUTH_SECRET`.** Losing it signs everyone out.

## What the image does on start

Migrations are not a separate step. The entrypoint applies any pending ones
before the app serves anything, under a PostgreSQL advisory lock, so several
containers starting at once is safe.

|             |                                                                                                                                   |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Port        | `3000`                                                                                                                            |
| Volume      | `/data/uploads` — receipt files, when storage is local rather than S3                                                             |
| User        | non-root, uid 1001                                                                                                                |
| Healthcheck | `GET /api/health/live`; `/api/health/ready` also touches the database                                                             |
| Worker      | `command: ["node", "dist/worker.js"]` runs the background jobs in their own container. Left to itself, the web process runs them. |

## Configuration

Everything is environment variables — database, storage, SMTP, Sign in with
Apple, exchange rates, receipt scanning, push notifications, telemetry,
metrics. They are documented one by one in
[docs/environment.md](https://github.com/sebitr/balancia/blob/main/docs/environment.md),
and the deployment side of them in
[docs/self-hosting.md](https://github.com/sebitr/balancia/blob/main/docs/self-hosting.md).

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Migrations are forward-only and never destructive without warning, and an
already-applied migration whose file has changed fails startup loudly rather
than running twice. Take a backup first anyway:
[docs/backup-and-restore.md](https://github.com/sebitr/balancia/blob/main/docs/backup-and-restore.md).

## Licence

AGPL-3.0-or-later. The source for this image is
[github.com/sebitr/balancia](https://github.com/sebitr/balancia).
