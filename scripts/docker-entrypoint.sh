#!/bin/sh
# Runtime entrypoint for the production image.
#
# Three jobs, then it hands the container over to its command (`node server.js`
# for the web role, `node dist/worker.js` for the worker).
#
#   1. Assemble DATABASE_URL from POSTGRES_PASSWORD, if it is not already set.
#   2. Apply any pending migrations.
#   3. Say so if an optional local-inference feature is switched on without the
#      files it reads.
#
# Both roles do step 2 on every start. Running them concurrently is safe: the
# runner takes a PostgreSQL advisory lock, so the second container blocks until
# the first is done and then finds the schema already current.
#
# Set RUN_MIGRATIONS=false to skip it — for a one-off `docker compose run`, or
# when you would rather apply migrations yourself before rolling the app:
#
#   docker compose run --rm --entrypoint "node dist/migrate.js" app
set -eu

# Compose passes the password, not a URL, so that the password can be any
# string the operator likes. Percent-encode it before splicing: a literal '/',
# '#', '?' or '@' would end the authority section, the port would stop parsing
# as a number, and pg would reject the whole thing with "Invalid URL".
#
# An explicit DATABASE_URL always wins — that is how you point the app at a
# database outside this Compose project.
if [ -z "${DATABASE_URL:-}" ] && [ -n "${POSTGRES_PASSWORD:-}" ]; then
  encoded=$(node -e 'process.stdout.write(encodeURIComponent(process.env.POSTGRES_PASSWORD))')
  DATABASE_URL="postgres://${POSTGRES_USER:-balancia}:${encoded}@${POSTGRES_HOST:-db}:${POSTGRES_PORT:-5432}/${POSTGRES_DB:-balancia}"
  export DATABASE_URL
fi

# The values the application treats as true; see TRUTHY in src/lib/env.ts.
is_enabled() {
  case "$(printf '%s' "${1:-}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')" in
    1 | true | yes | on) return 0 ;;
    *) return 1 ;;
  esac
}

# A demo container has no database to migrate: it builds the schema in memory
# from the same committed SQL when the server starts (see
# src/lib/db/demo-database.ts). Skipped here rather than left to the operator
# to remember, because the alternative is a stack that will not come up and a
# migration error that points at a database nobody meant to have.
if is_enabled "${DEMO_MODE:-}"; then
  echo "DEMO_MODE is on: skipping migrations. This container keeps everything" >&2
  echo "in memory and writes nothing to any database. See docs/demo.md." >&2
elif [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  node /app/dist/migrate.js || {
    echo "Migrations failed — not starting. Fix the error above, then: docker compose up -d" >&2
    exit 1
  }
fi

# A feature that is switched on but cannot find its files, said out loud.
#
# The failure this exists for is silent by design and therefore baffling: the
# browser makes one HEAD request for a model file, and where it 404s the entry
# point renders *nothing at all* — no error, no broken button, just a feature
# that is not there. `scripts/bootstrap.sh` says so for a host install; without
# this, a container said nothing.
#
# It also catches the more likely case, which is not a fresh install but an
# upgrade: the sentinel names the release the current build reads, so models
# left over from an older one read as missing, because to this build they are.
#
# Warn, never block. Scanning and semantic categorization are both optional and
# the rest of the application is perfectly fine without them.
warn_missing_models() {
  # $1 what to call it, $2 the switch, $3 the switch's value, $4 a file that
  # exists only once installed, $5 the command that installs it.
  is_enabled "$3" || return 0
  [ -e "$4" ] && return 0

  echo "WARNING: $1 is on, but its files are not in this container." >&2
  echo "         $2 is set, and this is missing:" >&2
  echo "           $4" >&2
  echo "         On the host run \`$5\`, then mount public/models" >&2
  echo "         into this container — see the volume commented out in" >&2
  echo "         compose.yaml, and docs/receipt-scanning.md." >&2
  echo "         Until then the feature simply will not appear." >&2
}

# Only the web role. The worker runs the same image with the same environment
# and never serves these files — compose mounts them into `app` alone — so
# checking there would warn about a directory it has no reason to have.
#
# The sentinels are spelled out because this script runs in an image that has
# no source tree to read them from. `src/lib/ocr/config.ts` (ACTIVE_MODEL_SET)
# is where they are actually decided, and `scripts/bootstrap.sh` keeps its own
# copy for the same reason; a model change has to touch all three.
case "$*" in
  *server.js*)
    warn_missing_models "Receipt scanning" RECEIPT_SCANNING \
      "${RECEIPT_SCANNING:-}" \
      /app/public/models/ocr/ppocrv6-tiny-det.onnx \
      "pnpm ocr:install --yes"
    warn_missing_models "Semantic categorization" SEMANTIC_CATEGORIZATION \
      "${SEMANTIC_CATEGORIZATION:-}" \
      /app/public/models/Xenova/paraphrase-multilingual-MiniLM-L12-v2/config.json \
      "pnpm semantic:install --yes"
    ;;
esac

exec "$@"
