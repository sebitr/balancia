#!/bin/sh
# Keeps the node_modules volume in step with the bind-mounted lockfile.
#
# node_modules lives in a named volume rather than the bind mount: the host's
# copy is built for darwin, and the container needs linux-musl binaries. The
# cost of that separation is drift — `pnpm add` on the host changes the
# lockfile but not the volume. So compare the two on every start and reinstall
# only when they differ, which is cheap enough to do unconditionally.
set -eu

STAMP=/app/node_modules/.balancia-lockfile-hash

if [ -f /app/pnpm-lock.yaml ]; then
  current=$(sha256sum /app/pnpm-lock.yaml | cut -d' ' -f1)
  previous=$(cat "$STAMP" 2>/dev/null || echo "")

  if [ "$current" != "$previous" ]; then
    if [ -z "$previous" ]; then
      echo "[dev-entrypoint] Installing dependencies…"
    else
      echo "[dev-entrypoint] Lockfile changed since the last start; reinstalling…"
    fi
    pnpm install --frozen-lockfile
    printf '%s' "$current" > "$STAMP"
  fi
fi

exec "$@"
