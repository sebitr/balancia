# syntax=docker/dockerfile:1.7

# Balancia production image.
#
# One image serves all three roles — web, worker and migrate — selected by the
# container command. Multi-stage so the runtime layer carries no build
# toolchain, no dev dependencies and no source beyond what is executed.
#
# Builds for linux/amd64 and linux/arm64: nothing here is architecture-specific
# and native modules (sharp is a dev dependency only) are avoided at runtime.

ARG NODE_VERSION=24-alpine

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

RUN pnpm build

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

# ── Stage: runtime ───────────────────────────────────────────────────────────
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat curl tini

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
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
COPY --from=deps --chown=balancia:balancia /app/node_modules ./node_modules

RUN mkdir -p /data/uploads && chown -R balancia:balancia /data

USER balancia
EXPOSE 3000
VOLUME ["/data"]

# tini reaps zombies and forwards SIGTERM, so graceful shutdown actually works.
ENTRYPOINT ["/sbin/tini", "--"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health/live || exit 1

CMD ["node", "server.js"]
