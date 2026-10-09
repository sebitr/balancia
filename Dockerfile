# syntax=docker/dockerfile:1.7

# Balancia production image.
#
# One image serves both roles — web and worker — selected by the container
# command. Either way the entrypoint applies pending migrations first. Multi-
# stage so the runtime layer carries no build toolchain, no dev dependencies
# and no source beyond what is executed.
#
# Builds for linux/amd64 and linux/arm64. Nothing written here is
# architecture-specific, and the one native module that reaches the runtime
# stage — sharp, which arrives as an optional dependency of `next` rather than
# as ours — publishes prebuilt binaries for both. `pnpm icons` uses sharp too,
# but that is a devDependency and runs on the developer's machine.

ARG NODE_VERSION=24-alpine

# The transport for cloud backups (docs/cloud-backup.md). One static binary,
# MIT-licensed, that speaks to every provider Balancia offers; copied out of the
# project's own image so that nothing is downloaded by a RUN line and the
# version below is the whole of what changes it. Multi-arch, like the rest of
# this file. Raising it is a deliberate act: read rclone's changelog for the
# backends in src/modules/backup/providers.ts first, because two of them
# (Proton Drive and iCloud Drive) track undocumented interfaces.
ARG RCLONE_VERSION=1.75.2
FROM rclone/rclone:${RCLONE_VERSION} AS rclone

# ── Stage: dependencies ──────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS deps
WORKDIR /app

# libc6-compat keeps glibc-linked prebuilt binaries working on musl.
RUN apk add --no-cache libc6-compat

RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
# BuildKit cache mount keeps the pnpm store between builds without baking it in.
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile

# ── Stage: production dependencies ───────────────────────────────────────────
# The same lockfile resolved again with the dev half left out, because the
# runtime stage copies a node_modules and whatever is in it ships. Installed
# separately rather than pruned from `deps`, so the build stage keeps the
# toolchain it needs while this stays the only tree the image carries.
FROM node:${NODE_VERSION} AS proddeps
WORKDIR /app

RUN apk add --no-cache libc6-compat
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    pnpm config set store-dir /pnpm/store && \
    pnpm install --frozen-lockfile --prod

# ── Stage: build ─────────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS builder
WORKDIR /app
RUN apk add --no-cache libc6-compat
RUN corepack enable

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Next.js reads env at build time for anything inlined into client bundles.
# Balancia inlines nothing secret, but the build still needs these to pass the
# environment schema. Real values are supplied at runtime.
ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    APP_URL=http://localhost:3000 \
    DATABASE_URL=postgres://build:build@localhost:5432/build \
    AUTH_SECRET=build-time-placeholder-not-used-at-runtime-0123456789

# `next build` keeps Turbopack's work in .next/cache, and a build that starts
# from it redoes only what changed, in a fraction of the time. No layer can
# carry it — `COPY . .` above changes with every commit, and .next is in
# .dockerignore — so it lives in a BuildKit cache mount, like the pnpm store:
# kept by the builder between builds on the same host, never part of the
# image, and simply empty the first time.
#
# The host that gains is a server running scripts/deploy.sh, whose
# `up --build` builds here after every pull. GitHub's runners start with an
# empty builder, and the gha cache that ci.yml and release.yml build with
# stores layers, not mounts, so their image builds stay cold, as before.
#
# One cache per architecture, because Turbopack's cache belongs to the build of
# Next that wrote it. Locked, so that two builds for one architecture at once
# take turns with it rather than both writing it.
ARG TARGETARCH
RUN --mount=type=cache,id=next-build-${TARGETARCH},target=/app/.next/cache,sharing=locked \
    pnpm build

# Bundle the worker and migrator into standalone JS so the runtime stage needs
# neither tsx nor the TypeScript sources. `server-only` is aliased away because
# it is a bundler-time guard that throws when imported by plain Node.
RUN pnpm exec esbuild src/worker/index.ts \
      --bundle --platform=node --target=node24 --format=esm \
      --outfile=dist/worker.js --packages=external \
      --alias:server-only=./scripts/server-only-noop.js \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" && \
    pnpm exec esbuild scripts/migrate.ts \
      --bundle --platform=node --target=node24 --format=esm \
      --outfile=dist/migrate.js --packages=external \
      --alias:server-only=./scripts/server-only-noop.js \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# The three setup helpers, bundled for the same reason and one more: a
# standalone install has no checkout for them to import src/ from, so
# scripts/bootstrap.sh runs these out of this image instead of borrowing a
# Node and a TypeScript loader. They are the same files `pnpm ocr:install`,
# `pnpm semantic:install` and `pnpm push:keys` run, so what gets downloaded and
# how a VAPID pair is built stay stated once.
#
# --outdir rather than --outfile: three entry points, and the names have to
# come out as dist/<name>.js because that is what bootstrap.sh calls them.
# Both fetchers resolve public/models against the working directory, so the
# container that runs them is given the installation as its workdir.
RUN pnpm exec esbuild \
      scripts/fetch-ocr-model.ts \
      scripts/fetch-semantic-model.ts \
      scripts/generate-push-keys.ts \
      --bundle --platform=node --target=node24 --format=esm \
      --outdir=dist --packages=external \
      --alias:server-only=./scripts/server-only-noop.js \
      --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);"

# ── Stage: runtime ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat curl tini

# NEXT_MANUAL_SIG_HANDLE tells Next's server not to answer SIGTERM itself —
# its handler exits the moment the HTTP server closes, cutting off whatever
# job the in-web worker is running. src/worker/shutdown.ts answers it instead:
# the jobs in hand get SHUTDOWN_DRAIN_MS to finish, then the process exits.
# Set here and not offered as a setting: it is only right beside the handler
# this image carries, and Next reads it before loading any .env file. The
# worker command ignores it; it has handlers of its own.
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NEXT_MANUAL_SIG_HANDLE=true \
    PORT=3000 \
    HOSTNAME=0.0.0.0 \
    STORAGE_LOCAL_PATH=/data/uploads

# Non-root: the app never needs to write outside /data.
RUN addgroup --system --gid 1001 balancia && \
    adduser --system --uid 1001 --ingroup balancia balancia

# Next standalone output: server.js plus only the modules it actually needs.
COPY --from=builder --chown=balancia:balancia /app/.next/standalone ./
COPY --from=builder --chown=balancia:balancia /app/.next/static ./.next/static
COPY --from=builder --chown=balancia:balancia /app/public ./public

# Worker and migrator bundles, plus the SQL migrations they apply.
COPY --from=builder --chown=balancia:balancia /app/dist ./dist
COPY --from=builder --chown=balancia:balancia /app/drizzle ./drizzle

# node_modules for the bundles' external dependencies (pg, pg-boss, pino …).
# From `proddeps`, not `deps`: the latter carries the build toolchain as well,
# and copying it here put esbuild, TypeScript, Vitest, Playwright and sharp in
# the shipped image — none of them reachable, all of them advisory surface that
# `pnpm audit --prod` in CI does not look at.
COPY --from=proddeps --chown=balancia:balancia /app/node_modules ./node_modules

# Applies pending migrations before handing over to the command below.
COPY --chmod=755 scripts/docker-entrypoint.sh /app/docker-entrypoint.sh

# Runs as the unprivileged user above and is handed only the settings for the
# one remote it is talking to; see src/modules/backup/rclone.ts.
COPY --from=rclone /usr/local/bin/rclone /usr/local/bin/rclone

RUN mkdir -p /data/uploads && chown -R balancia:balancia /data

USER balancia
EXPOSE 3000
VOLUME ["/data"]

# tini reaps zombies and forwards SIGTERM, so graceful shutdown actually works.
# The entrypoint script `exec`s the command, so the real process stays tini's
# direct child and still receives that signal.
ENTRYPOINT ["/sbin/tini", "--", "/app/docker-entrypoint.sh"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health/live || exit 1

CMD ["node", "server.js"]
