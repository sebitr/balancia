#!/bin/sh
# Runtime entrypoint for the production image.
#
# Two jobs, then it hands the container over to its command (`node server.js`
# for the web role, `node dist/worker.js` for the worker).
#
#   1. Assemble DATABASE_URL from POSTGRES_PASSWORD, if it is not already set.
#   2. Apply any pending migrations.
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

if [ "${RUN_MIGRATIONS:-true}" != "false" ]; then
  node /app/dist/migrate.js || {
    echo "Migrations failed — not starting. Fix the error above, then: docker compose up -d" >&2
    exit 1
  }
fi

exec "$@"
