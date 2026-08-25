#!/bin/sh
# Balancia — drive the local Weblate.
#
#   ./scripts/weblate.sh up      start it, and set the project up on first run
#   ./scripts/weblate.sh sync    send the latest English strings to Weblate
#   ./scripts/weblate.sh pull    bring translated messages/ back into this tree
#   ./scripts/weblate.sh down    stop it, keeping everything
#   ./scripts/weblate.sh reset   stop it and throw the instance away
#   ./scripts/weblate.sh logs    follow the container logs
#
#   -h, --help              this text
#   --color, --no-color     settle the colour rather than detecting it
#
# The stack itself is compose.weblate.yaml. This script is the part that keeps
# a translation tool and a repository with a branch-per-chat rule out of each
# other's way.
#
# Weblate needs a git repository it can clone and push to, and it must not be
# this working tree: it would commit onto whichever branch happened to be
# checked out. So it gets a bare mirror of its own at
# .weblate-mirror/balancia.git, which is ignored by git and belongs entirely to
# this script.
#
#   sync   force-updates the mirror's main from origin/main, then tells Weblate
#          to pull. The mirror is scratch, so forcing is safe — Weblate's own
#          clone and database hold anything it has not pushed yet, and it
#          rebases onto whatever main has become.
#
#   pull   makes Weblate commit and push what translators have written, fetches
#          that from the mirror, and writes messages/ into this working tree
#          and nowhere else. Nothing is staged and nothing is committed: what
#          you get is an unstaged diff over messages/, on your own branch, to
#          read and commit yourself.
#
# So the round trip is: `up`, translate in the browser, `pull`, review the
# diff, `pnpm test`, commit, open a pull request. After it merges, `sync` puts
# the merged state back under Weblate and its own copies of those commits fall
# away as already-applied.
#
# Adding a language is the same trip with one extra stop: Weblate writes a new
# messages/<code>.json, and the app does not load a catalogue it has not been
# told about. `pnpm test` fails until it has been — see docs/translations.md
# for the six files that need the new code.
#
# Everything here is idempotent. `up` on a running instance re-applies the
# component definition and changes nothing else.
set -eu

root_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
compose_file="$root_dir/compose.weblate.yaml"
exchange_dir="$root_dir/.weblate-mirror"
mirror="$exchange_dir/balancia.git"

port=${WEBLATE_PORT:-8090}
url="http://localhost:$port"
project=balancia
component=messages
# What Weblate translates. origin/main is the right answer nearly always: a
# translator should see the strings that are shipping, not the ones on a branch
# that may never land. Point it elsewhere to translate a branch's new strings
# before it merges.
source_ref=${WEBLATE_SOURCE_REF:-origin/main}
# First start migrates a fresh database and can genuinely take minutes.
timeout=${WEBLATE_TIMEOUT:-600}

colour=auto
command=
for arg in "$@"; do
  case $arg in
    --color | --colour) colour=always ;;
    --no-color | --no-colour) colour=never ;;
    -h | --help | help) command=help ;;
    -*) printf 'Unknown option: %s\n' "$arg" >&2 && exit 2 ;;
    *) [ -n "$command" ] || command=$arg ;;
  esac
done
[ -n "$command" ] || command=help

want_colour() {
  case $colour in
    always) return 0 ;;
    never) return 1 ;;
  esac
  [ -z "${NO_COLOR-}" ] || return 1
  [ -z "${FORCE_COLOR-}" ] || return 0
  [ "${TERM-}" != dumb ] || return 1
  [ -t 1 ]
}

if want_colour; then
  bold=$(printf '\033[1m')
  dim=$(printf '\033[2m')
  red=$(printf '\033[31m')
  green=$(printf '\033[32m')
  yellow=$(printf '\033[33m')
  reset=$(printf '\033[0m')
else
  bold= dim= red= green= yellow= reset=
fi

say() { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "$bold" "$reset" "$*"; }
note() { printf '%s%s%s\n' "$dim" "$*" "$reset"; }
warn() { printf '%s!%s %s\n' "$yellow" "$reset" "$*" >&2; }
die() {
  printf '%sx%s %s\n' "$red" "$reset" "$*" >&2
  exit 1
}

usage() {
  sed -n '2,/^set -eu$/p' "$0" | sed 's/^# \{0,1\}//; s/^set -eu$//'
}

compose() {
  docker compose -f "$compose_file" "$@"
}

# Weblate's own command line, inside the container, as the user it runs as.
weblate_cli() {
  compose exec -T --user weblate weblate weblate "$@"
}

require_docker() {
  command -v docker >/dev/null 2>&1 || die "docker is not installed."
  docker version >/dev/null 2>&1 ||
    die "the Docker daemon is not reachable — start Docker (or \`colima start\`) and try again."
}

running() {
  [ -n "$(compose ps --status running --quiet weblate 2>/dev/null || true)" ]
}

require_running() {
  running || die "Weblate is not running. Start it with \`./scripts/weblate.sh up\`."
}

# Point the mirror's main at the strings Weblate should be translating.
refresh_mirror() {
  if [ ! -d "$mirror" ]; then
    step "Creating the mirror at .weblate-mirror/balancia.git"
    git init --bare --initial-branch=main --quiet "$mirror"
  fi

  case $source_ref in
    origin/*)
      git -C "$root_dir" fetch --quiet origin "${source_ref#origin/}" 2>/dev/null ||
        warn "could not reach origin; using the $source_ref this checkout already has."
      ;;
  esac

  git -C "$root_dir" rev-parse --verify --quiet "$source_ref^{commit}" >/dev/null ||
    die "$source_ref does not resolve to a commit. Set WEBLATE_SOURCE_REF to something that does."

  step "Sending $source_ref to the mirror"
  git -C "$root_dir" push --force --quiet "$mirror" "$source_ref:refs/heads/main"

  # The container's git runs as another uid against this bind mount, and has to
  # be able to write to it when Weblate pushes.
  chmod -R a+rwX "$exchange_dir"
}

wait_for_weblate() {
  step "Waiting for $url"
  deadline=$(($(date +%s) + timeout))
  while ! curl -fsS -o /dev/null --max-time 5 "$url/" 2>/dev/null; do
    if [ "$(date +%s)" -ge "$deadline" ]; then
      say ""
      die "Weblate did not answer within ${timeout}s. \`./scripts/weblate.sh logs\` says why."
    fi
    sleep 3
  done
}

# The project, the component, and the two settings the component API does not
# carry. Re-running this is how a change to scripts/weblate-component.json
# reaches a Weblate that already exists.
bootstrap() {
  step "Creating the Balancia project"
  weblate_cli shell <<PY
from weblate.trans.models import Project

Project.objects.get_or_create(
    slug="$project",
    defaults={"name": "Balancia", "web": "https://balancia.app"},
)
PY

  step "Applying the component definition"
  weblate_cli import_json --project "$project" --update /config/component.json

  # Weblate's JSON writer indents with four spaces; prettier formats this
  # repository with two, and a translation Weblate saves is a file prettier
  # would immediately rewrite. Set on the object rather than sent with the
  # component above, because this is a model field of Weblate 5.13 and later
  # rather than something the component API is known to accept.
  step "Matching the JSON indentation to prettier"
  weblate_cli shell <<PY
from weblate.trans.models import Component

component = Component.objects.get(project__slug="$project", slug="$component")
if hasattr(component, "file_format_params"):
    component.file_format_params = {"json_indent": 2, "json_sort_keys": False}
    component.save(update_fields=["file_format_params"])
else:
    print(
        "This Weblate predates file format parameters (5.13); "
        "\`pnpm format\` after every pull will do the same job."
    )
PY

  # Keeps a translation file from carrying keys that English no longer has,
  # which is the other half of what src/i18n/messages.test.ts checks.
  step "Installing the cleanup add-on"
  weblate_cli install_addon --addon weblate.cleanup.generic --update --all >/dev/null
}

cmd_up() {
  require_docker
  refresh_mirror

  step "Starting the stack"
  compose up -d

  wait_for_weblate
  bootstrap

  say ""
  say "${green}Weblate is up.${reset}"
  say "  ${bold}$url${reset}   admin / weblate"
  say ""
  note "Translate in the browser, then \`./scripts/weblate.sh pull\` to bring"
  note "messages/ back into this working tree."
}

cmd_sync() {
  require_docker
  require_running
  refresh_mirror

  step "Telling Weblate to pull"
  weblate_cli updategit --all

  say "${green}Weblate is now translating $source_ref.${reset}"
}

cmd_pull() {
  require_docker
  require_running

  step "Committing what translators have written"
  weblate_cli commit_pending --all --age 0

  step "Pushing it to the mirror"
  weblate_cli pushgit --all

  step "Fetching the mirror"
  git -C "$root_dir" fetch --quiet "$mirror" main

  step "Writing messages/ into this working tree"
  git -C "$root_dir" restore --source=FETCH_HEAD -- messages

  if [ -x "$root_dir/node_modules/.bin/prettier" ]; then
    step "Formatting"
    "$root_dir/node_modules/.bin/prettier" --write --log-level warn "$root_dir/messages"
  else
    note "node_modules is not installed here; run \`pnpm format\` before committing."
  fi

  say ""
  changed=$(git -C "$root_dir" status --short -- messages)
  if [ -z "$changed" ]; then
    say "${green}Nothing changed — messages/ already matches Weblate.${reset}"
    return
  fi

  say "${green}messages/ updated:${reset}"
  say "$changed"
  say ""
  note "Nothing is staged. Read \`git diff -- messages\`, run \`pnpm test\`, then"
  note "commit on your own branch."

  # A file the app has never been told about renders raw keys rather than
  # words, so say so here as well as in the test that fails later.
  for file in "$root_dir"/messages/*.json; do
    code=$(basename "$file" .json)
    grep -q "\"$code\"" "$root_dir/src/i18n/locales.ts" || {
      say ""
      warn "messages/$code.json is a language this app does not load yet."
      warn "docs/translations.md lists the six files that have to name \"$code\"."
    }
  done
}

cmd_down() {
  require_docker
  step "Stopping the stack"
  compose down
  note "The instance is kept. \`./scripts/weblate.sh up\` brings it back as it was."
}

cmd_reset() {
  require_docker
  warn "This deletes the Weblate database, its clone, and the mirror."
  warn "Anything translated but never pulled is gone with them."
  if [ -t 0 ]; then
    printf 'Type %syes%s to continue: ' "$bold" "$reset"
    read -r answer
    [ "$answer" = yes ] || die "Nothing was deleted."
  else
    die "Refusing to reset without a terminal to confirm on."
  fi

  step "Removing the stack and its volumes"
  compose down --volumes
  step "Removing the mirror"
  rm -rf "$exchange_dir"
  say "${green}Gone.${reset} \`./scripts/weblate.sh up\` starts over."
}

cmd_logs() {
  require_docker
  compose logs --follow --tail 100
}

case $command in
  up) cmd_up ;;
  sync) cmd_sync ;;
  pull) cmd_pull ;;
  down) cmd_down ;;
  reset) cmd_reset ;;
  logs) cmd_logs ;;
  help) usage ;;
  *) die "Unknown command: $command. Try \`./scripts/weblate.sh help\`." ;;
esac
