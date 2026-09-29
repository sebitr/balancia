#!/usr/bin/env bash
# Balancia — back up an installation.
#
#   ./scripts/backup.sh [options] [DEST]      in a checkout
#   ./backup.sh [options] [DEST]              in a standalone install
#
# Writes one directory under DEST, named for the moment it was taken in UTC
# (20260929T033000Z), holding the three things docs/backup-and-restore.md says
# have to be kept together:
#
#   balancia.dump     the database, as a pg_dump custom-format archive
#   uploads.tar.gz    the receipts volume — absent when STORAGE_DRIVER=s3 keeps
#                     them in a bucket, which has to be backed up on its own
#   env               a copy of .env, the only copy of AUTH_SECRET and
#                     POSTGRES_PASSWORD there is
#
# DEST defaults to backups/ beside compose.yaml, and a relative DEST is taken
# from wherever this was started. The installation itself is found from where
# this file is, so a cron line does not have to cd anywhere first.
#
# pg_dump runs inside the db container: the host needs no PostgreSQL client of
# its own, and the dump is always written by the same major version that holds
# the data.
#
#   -k, --keep N          once this backup is safely written, delete all but
#                         the N newest in DEST (default: keep every one)
#       --database-only   the dump and nothing else — the restore point
#                         scripts/deploy.sh takes before every upgrade
#   -h, --help            this text
#
# Progress goes to stderr. The one line on stdout is the directory it wrote, so
# that whatever called it can say where the backup went.
#
# Exit status is 0 only when every part was written and the dump reads back.
# Anything short of that removes the half-written directory and exits non-zero:
# a backup missing a part is not one anybody can restore from, and leaving it
# beside the good ones is how it gets restored from anyway.
#
# Needs bash rather than sh, for pipefail.
set -euo pipefail

# The dump is every expense this instance holds and env is its secrets, so
# nothing written here should be readable by anybody else on the host — not
# even for the moment between writing a file and a chmod catching up with it.
umask 077

# Plain text on purpose: the usual reader of this is a cron log, not a person.
pad='      '

note() {
  printf '%s%s\n' "$pad" "$1" >&2
}

done_line() {
  printf '  ✓  %s\n' "$1" >&2
}

die() {
  printf '\n  ✗  %s\n' "$1" >&2
  shift
  if [ $# -gt 0 ]; then
    printf '%s\n' "$@" | sed "s/^/$pad/" >&2
  fi
  exit 1
}

# The comment header above is the help text; there is only one copy of it.
usage() {
  sed -n '2,/^set -euo pipefail$/p' "$0" | sed -e '$d' -e 's/^#//' -e 's/^ //'
  exit 0
}

keep=0
database_only=false
dest=''

while [ $# -gt 0 ]; do
  case $1 in
    -k | --keep)
      [ $# -ge 2 ] || die '--keep needs a number.'
      keep=$2
      shift 2
      ;;
    --keep=*)
      keep=${1#--keep=}
      shift
      ;;
    --database-only)
      database_only=true
      shift
      ;;
    -h | --help) usage ;;
    -*) die "Unknown option: $1" "Run $0 --help for the list." ;;
    *)
      [ -z "$dest" ] || die "One destination at a time: $dest, or $1?"
      dest=$1
      shift
      ;;
  esac
done

case $keep in
  '' | *[!0-9]*) die "--keep takes a whole number: $keep" ;;
esac

# The installation is the directory holding compose.yaml: this file's own in a
# standalone install, the one above it in a checkout — the same two shapes
# bootstrap.sh tells apart — or, failing both, wherever it was started. Its own
# directory is asked first, so that a standalone install in a directory whose
# parent happens to hold a compose.yaml of its own still backs up itself.
script_dir=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd)
if [ -e "$script_dir/compose.yaml" ]; then
  root_dir=$script_dir
elif [ -e "$script_dir/../compose.yaml" ]; then
  root_dir=$(CDPATH='' cd -- "$script_dir/.." && pwd)
elif [ -e "$PWD/compose.yaml" ]; then
  root_dir=$PWD
else
  die 'Cannot find the installation.' \
    'Run this from the directory holding compose.yaml, or keep it beside it.'
fi

case $dest in
  '') dest_root="$root_dir/backups" ;;
  /*) dest_root=$dest ;;
  *) dest_root="$PWD/$dest" ;;
esac

cd -- "$root_dir"

[ -f .env ] || die "No .env in $root_dir." \
  'Compose cannot start this stack without one, so there is nothing to back up.'
command -v docker > /dev/null 2>&1 || die 'docker is not on PATH.'

# The value the application will see: last assignment wins, one layer of
# quoting removed. The same reading bootstrap.sh does.
value_of() {
  local raw
  raw=$(grep -E "^[[:space:]]*$1=" .env | tail -n 1 | sed "s/^[[:space:]]*$1=//") || true
  case $raw in
    "'"*"'")
      raw=${raw#\'}
      raw=${raw%\'}
      ;;
    '"'*'"')
      raw=${raw#\"}
      raw=${raw%\"}
      ;;
  esac
  printf '%s' "$raw"
}

mkdir -p -- "$dest_root" 2> /dev/null || die "Could not create $dest_root"
dest_root=$(CDPATH='' cd -- "$dest_root" && pwd)

# Not -p: a directory already there is a backup taken this same second, and
# writing into it would mix two of them. The next second is a name of its own.
dir=''
for _ in 1 2 3; do
  candidate="$dest_root/$(date -u +%Y%m%dT%H%M%SZ)"
  if mkdir -- "$candidate" 2> /dev/null; then
    dir=$candidate
    break
  fi
  [ -e "$candidate" ] || die "Could not create $candidate" "Is $dest_root writable?"
  sleep 1
done
[ -n "$dir" ] || die "Could not find a free name for this backup in $dest_root."

complete=false
discard_incomplete() {
  if [ "$complete" != true ]; then
    rm -rf -- "$dir"
    printf '  ✗  Removed the incomplete %s\n\n' "$dir" >&2
  fi
}
trap discard_incomplete EXIT
trap 'exit 130' INT TERM

printf '\n  Balancia — backup\n  ─────────────────\n\n' >&2
note "$dir"
printf '\n' >&2

# Every `docker compose exec` gets its stdin from somewhere explicit. Compose
# forwards stdin into the container by default, and a caller that is itself
# being read from stdin — deploy.sh's remote half is exactly that — would have
# the rest of its own script swallowed by pg_dump.
docker compose exec -T db \
  pg_dump -U balancia -d balancia --format=custom --no-owner \
  < /dev/null > "$dir/balancia.dump" ||
  die 'pg_dump failed.' 'Is the database running? docker compose ps db'

# Read back through the same container. pg_restore --list refuses anything
# that is not a whole archive header — an empty file, an error message that
# ended up where the dump should be — which is the cheap half of "a backup you
# have never restored is a hypothesis".
[ -s "$dir/balancia.dump" ] || die 'pg_dump wrote nothing.'
docker compose exec -T db pg_restore --list \
  < "$dir/balancia.dump" > /dev/null ||
  die 'The dump does not read back as a pg_dump archive.'
done_line "Database   $(du -h "$dir/balancia.dump" | cut -f1)"

if [ "$database_only" = false ]; then
  if [ "$(value_of STORAGE_DRIVER)" = s3 ]; then
    done_line 'Receipts   not here: STORAGE_DRIVER=s3'
    note "They are in the bucket $(value_of S3_BUCKET), which this script cannot see."
    note 'Back it up on its own — docs/backup-and-restore.md, "If you use S3".'
  else
    # compose.yaml names the volume outright, so it is the same whatever the
    # project is called. Looked up first, because `docker run -v` would
    # otherwise create an empty one and the tarball of it would look like a
    # backup of nothing that went perfectly.
    docker volume inspect balancia-uploads > /dev/null 2>&1 ||
      die 'There is no balancia-uploads volume on this host.' \
        'Has this stack ever been started? docker compose up -d'
    docker run --rm -v balancia-uploads:/data:ro alpine:3.21 \
      tar czf - -C /data . \
      < /dev/null > "$dir/uploads.tar.gz" ||
      die 'Could not archive the balancia-uploads volume.'
    done_line "Receipts   $(du -h "$dir/uploads.tar.gz" | cut -f1)"
  fi

  cp -- .env "$dir/env"
  done_line 'Secrets    env'
  note 'env holds AUTH_SECRET and POSTGRES_PASSWORD in the clear. Keep this'
  note 'directory where only you can read it, and encrypt it before it leaves'
  note 'this machine — docs/backup-and-restore.md shows one way.'
fi

complete=true

# Retention only ever runs after a backup has been written whole, so a run that
# fails can never leave fewer good backups behind than it found. Only names
# this script writes are counted, and never the one it has just written — a
# clock that went backwards must not make the newest backup the oldest.
if [ "$keep" -gt 0 ]; then
  LC_COLLATE=C
  set -- "$dest_root"/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]T[0-9][0-9][0-9][0-9][0-9][0-9]Z
  excess=$(($# - keep))
  removed=''
  for old in "$@"; do
    [ "$excess" -gt 0 ] || break
    [ "$old" != "$dir" ] && [ -d "$old" ] || continue
    rm -rf -- "$old"
    removed="$removed $(basename -- "$old")"
    excess=$((excess - 1))
  done
  if [ -n "$removed" ]; then
    done_line "Retention  kept the newest $keep"
    note "Removed$removed"
  fi
fi

printf '\n  To restore the database from it, with the app stopped first\n' >&2
printf '  (docker compose stop app, and worker if it has its own container):\n\n' >&2
printf "    docker compose exec -T db pg_restore -U balancia -d postgres --clean --if-exists --create --no-owner < '%s'\n\n" \
  "$dir/balancia.dump" >&2

printf '%s\n' "$dir"
