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

  # An empty .bin means the tree is there but unusable — a half-written volume,
  # usually from a start that ran out of disk. pnpm's own state file survives
  # that and makes it report "Already up to date", so check the thing that
  # actually matters and rebuild from scratch when it is missing.
  if [ -d /app/node_modules ] && [ ! -e /app/node_modules/.bin/next ]; then
    echo "[dev-entrypoint] node_modules is incomplete; reinstalling from scratch…"
    rm -rf /app/node_modules/* /app/node_modules/.[!.]* 2>/dev/null || true
    previous=""
  fi

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
