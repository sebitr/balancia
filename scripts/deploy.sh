#!/bin/sh
# Balancia — deploy to the production host.
#
#   ./scripts/deploy.sh
#
# Over SSH, in the checkout on the server:
#
#   git pull --ff-only
#   ./scripts/backup.sh --database-only --keep 10 backups/pre-deploy
#   docker compose pull --ignore-buildable app
#   docker compose up -d --build
#
# and then waits for the containers to come back healthy before it says the
# deploy worked. Those four commands are the deploy; everything else here is
# the checking around them, so that a run either finishes or stops somewhere it
# can be understood.
#
# Nothing is pushed from this machine — the server pulls from origin. A deploy
# therefore ships what is merged, not what happens to be in the working tree it
# was started from, and running it from a feature branch is harmless.
#
# Merged is not the same as tested, though: origin's branch moves the moment a
# pull request merges, well before CI has finished with the result. So before
# anything changes, the commit the server is about to land is looked up on
# GitHub, and the deploy stops if any check on it failed or is still running.
# That needs the GitHub CLI, signed in (`gh auth login`), on this machine.
#
#   -H, --host HOST     ssh target: an alias from ~/.ssh/config, or user@host
#                       (default: ecom-debian, or BALANCIA_DEPLOY_HOST)
#   -C, --path PATH     the checkout on the server, absolute or relative to the
#                       login directory
#                       (default: balancia, or BALANCIA_DEPLOY_PATH)
#       --skip-backup   deploy without taking the database dump first
#   -n, --dry-run       run every check and print the plan; change nothing
#       --skip-checks   deploy without asking GitHub whether CI passed
#   -h, --help          this text
#
#   --color, --no-color settle the colour rather than detecting it
#
# The health wait gives up after BALANCIA_DEPLOY_TIMEOUT seconds (default 180)
# and prints what it was still waiting for. That is a timeout on the waiting,
# not on the containers: they are up either way, and `docker compose logs` on
# the server is the next thing to read.
#
# The dump between the pull and the restart is the restore point. Migrations
# only go forwards, so a copy of the database taken before the new image
# starts is the one way back from an upgrade that went wrong — and when it
# cannot be taken, nothing is restarted and the exit status is 3. The last ten
# are kept, under backups/pre-deploy in the checkout; --skip-backup goes ahead
# without one, for whoever has decided that it is not needed.
#
# Exit status is 0 only when every service ended up running, and healthy if it
# has a healthcheck to say so.
set -eu

host=${BALANCIA_DEPLOY_HOST:-ecom-debian}
path=${BALANCIA_DEPLOY_PATH:-balancia}
timeout=${BALANCIA_DEPLOY_TIMEOUT:-180}
backup=true
dry_run=false
check_ci=true

# Colour when stdout is a terminal that wants it — the same rules, in the same
# precedence, as bootstrap.sh. Read in its own pass because usage() needs the
# palette before the real argument loop runs.
colour=auto
for arg in "$@"; do
  case $arg in
    --color | --colour) colour=always ;;
    --no-color | --no-colour) colour=never ;;
  esac
done

want_colour() {
  case $colour in
    always) return 0 ;;
    never) return 1 ;;
  esac
  [ -z "${NO_COLOR-}" ] || return 1
  [ -z "${FORCE_COLOR-}" ] || return 0
  [ -z "${CLICOLOR_FORCE-}" ] || return 0
  [ -t 1 ] && [ "${TERM-}" != dumb ]
}

if want_colour; then
  bold=$(printf '\033[1m')
  dim=$(printf '\033[2m')
  red=$(printf '\033[31m')
  green=$(printf '\033[32m')
  cyan=$(printf '\033[36m')
  reset=$(printf '\033[0m')
else
  bold=''
  dim=''
  red=''
  green=''
  cyan=''
  reset=''
fi

# Two indents, as in bootstrap.sh: headings at 2, what belongs to them at 6.
pad='      '

note() {
  printf '%s%s\n' "$pad" "$1"
}

done_line() {
  printf '  %s✓%s  %s\n' "$green" "$reset" "$1"
}

step() {
  printf '\n  %s%s%s\n' "$bold" "$1" "$reset"
}

# Everything that stops the deploy comes through here, so a failure has one
# shape wherever it happened: the headline, then whatever detail was collected,
# indented under it.
die() {
  printf '\n  %s✗%s  %s\n' "$red" "$reset" "$1" >&2
  shift
  if [ $# -gt 0 ]; then
    printf '%s\n' "$@" | grep -v '^[[:space:]]*$' | sed "s/^/$pad/" >&2 || true
  fi
  printf '\n' >&2
  exit 1
}

# The comment header above is the help text; there is only one copy of it.
usage() {
  sed -n '2,/^set -eu$/p' "$0" | sed -e '$d' -e 's/^#//' -e 's/^ //'
  exit 0
}

while [ $# -gt 0 ]; do
  case $1 in
    -H | --host)
      [ $# -ge 2 ] || die '--host needs a value.'
      host=$2
      shift 2
      ;;
    -C | --path)
      [ $# -ge 2 ] || die '--path needs a value.'
      path=$2
      shift 2
      ;;
    --skip-backup)
      backup=false
      shift
      ;;
    -n | --dry-run)
      dry_run=true
      shift
      ;;
    --skip-checks)
      check_ci=false
      shift
      ;;
    -h | --help) usage ;;
    --color | --colour | --no-color | --no-colour) shift ;;
    *) die "Unknown option: $1" "Run $0 --help for the list." ;;
  esac
done

# The path is expanded by the login shell on the server, which is what lets a
# leading ~ work. It also means whitespace in it would split into two
# arguments, so that is refused here rather than misbehaving over there.
case $path in
  *[[:space:]]*) die "The checkout path may not contain whitespace: $path" ;;
esac

case $timeout in
  '' | *[!0-9]*) die "BALANCIA_DEPLOY_TIMEOUT must be a whole number of seconds: $timeout" ;;
esac

# Word-split on purpose, so the options arrive as separate arguments.
# shellcheck disable=SC2086
ssh_opts='-o ConnectTimeout=10'

printf '\n  %sBalancia%s — deploy\n' "$bold" "$reset"
printf '  %s──────────────────%s\n' "$dim" "$reset"
printf '\n%s%s%s%s  %s%s%s\n' "$pad" "$cyan" "$host" "$reset" "$dim" "$path" "$reset"

# ── looking ─────────────────────────────────────────────────────────────────

step 'Checking the server'

# Every precondition in one round trip, before anything is changed. The remote
# side prints a plain sentence and exits non-zero; ssh carries that status back
# and die() puts the sentence at the top of the message. `git fetch` belongs to
# this half rather than the next: it touches no working tree, and it is what
# makes the plan printed below true.
#
# shellcheck disable=SC2029,SC2086  # $path is expanded by the remote shell, by design
if ! survey=$(ssh $ssh_opts "$host" "sh -s -- $path" 2>&1 <<'REMOTE'
set -eu
target=$1

cd -- "$target" 2>/dev/null || {
  echo "No such directory on this host: $target"
  echo "Point --path (or BALANCIA_DEPLOY_PATH) at the checkout."
  exit 1
}
git rev-parse --git-dir >/dev/null 2>&1 || {
  echo "Not a git checkout: $target"
  exit 1
}
[ -f compose.yaml ] || {
  echo "No compose.yaml in $target"
  exit 1
}
[ -f .env ] || {
  echo "No .env in $target"
  echo "Run ./scripts/bootstrap.sh there once, first."
  exit 1
}
docker compose version >/dev/null 2>&1 || {
  echo "docker compose is not available to this user."
  exit 1
}

branch=$(git rev-parse --abbrev-ref HEAD)
[ "$branch" != HEAD ] || {
  echo "The checkout is on a detached HEAD."
  echo "Put it back on a branch that tracks origin before deploying."
  exit 1
}
git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1 || {
  echo "$branch is not tracking an upstream branch."
  exit 1
}

dirty=$(git status --short)
[ -z "$dirty" ] || {
  echo "The working tree has uncommitted changes, so it cannot fast-forward."
  printf '%s\n' "$dirty"
  exit 1
}

git fetch --quiet origin 2>&1 || {
  echo "git fetch from origin failed."
  exit 1
}

echo "BRANCH $branch"
echo "UPSTREAM $(git rev-parse --abbrev-ref '@{upstream}')"
echo "HEAD $(git log --format='%h %s' -1)"
echo "URL $(sed -n 's/^APP_URL=//p' .env | tr -d "\"'" | head -1)"
echo "TARGET $(git rev-parse '@{upstream}')"
echo "ORIGIN $(git remote get-url origin)"
git log --format='LOG %h %s' 'HEAD..@{upstream}'
REMOTE
); then
  die "$(printf '%s\n' "$survey" | head -1)" "$(printf '%s\n' "$survey" | tail -n +2)"
fi

branch=$(printf '%s\n' "$survey" | sed -n 's/^BRANCH //p')
upstream=$(printf '%s\n' "$survey" | sed -n 's/^UPSTREAM //p')
head_line=$(printf '%s\n' "$survey" | sed -n 's/^HEAD //p')
url=$(printf '%s\n' "$survey" | sed -n 's/^URL //p')
target=$(printf '%s\n' "$survey" | sed -n 's/^TARGET //p')
origin_url=$(printf '%s\n' "$survey" | sed -n 's/^ORIGIN //p')
incoming=$(printf '%s\n' "$survey" | sed -n 's/^LOG //p')

done_line "$branch is clean, at $head_line"

if [ -n "$incoming" ]; then
  count=$(printf '%s\n' "$incoming" | wc -l | tr -d ' ')
  if [ "$count" = 1 ]; then
    step 'Pulling 1 commit'
  else
    step "Pulling $count commits"
  fi
  printf '%s\n' "$incoming" | sed "s/^/$pad/"
else
  step 'Nothing to pull'
  note "Already at $upstream."
  note 'The images are rebuilt anyway — a deploy that changes nothing is still'
  note 'the cheapest way to be sure the server runs what origin says it does.'
fi

# ── asking CI ───────────────────────────────────────────────────────────────

# The commit asked about is the upstream one, not the server's HEAD: it is what
# the pull below is about to check out, and it is the one checked even when
# there is nothing to pull, because a rebuild ships it all the same.
#
# On an instance that builds, a commit whose CI has not passed is code nothing
# has tested. On one that pulls :preview it is worse than that: release.yml
# publishes the image only once CI has passed, so the server would come back
# on the previous image with the new commit's compose files beside it.
#
# Every check run GitHub holds for the commit has to have finished, and each
# as a success — or skipped, or neutral, which is how a job that does not
# apply to this ref reports (the installer, on anything but a tag). Anything
# else stops here, and --skip-checks is the way past for whoever has decided
# to own it: GitHub being down, or a fork with no CI of its own.
step 'Checking CI'

short=$(printf '%s\n' "$target" | cut -c1-7)

if [ "$check_ci" = false ]; then
  note "Not asked: --skip-checks. $short goes out whatever its checks say."
else
  case $origin_url in
    *github.com[:/]*) ;;
    *)
      die "Cannot check CI: origin on the server is not a GitHub repository." \
        "$origin_url" \
        'Pass --skip-checks to deploy without asking.'
      ;;
  esac
  repo=${origin_url#*github.com[:/]}
  repo=${repo%/}
  repo=${repo%.git}

  command -v gh >/dev/null 2>&1 || die \
    'Cannot check CI: the GitHub CLI (gh) is not installed on this machine.' \
    "Install it and run \`gh auth login\`, or pass --skip-checks to deploy $short" \
    'without asking.'

  # One `name|status|conclusion` line per check run. A hundred is far more
  # than one commit collects here: CI's seven jobs and the publish jobs.
  if ! runs=$(gh api "repos/$repo/commits/$target/check-runs?per_page=100" \
    --jq '.check_runs[] | [.name, .status, (.conclusion // "")] | join("|")' 2>&1); then
    die "Could not read the checks on $short from GitHub ($repo)." \
      "$runs" \
      'Pass --skip-checks to deploy without asking.'
  fi

  [ -n "$runs" ] || die "Nothing has reported on $short yet." \
    'CI has probably not started. Wait for it, or pass --skip-checks.'

  failed=$(printf '%s\n' "$runs" | awk -F'|' '
    $2 == "completed" && $3 != "success" && $3 != "skipped" && $3 != "neutral" {
      print $1 " (" $3 ")"
    }
  ')
  pending=$(printf '%s\n' "$runs" | awk -F'|' '
    $2 != "completed" { print $1 " (" $2 ")" }
  ')

  [ -z "$failed" ] || die "CI did not pass on $short, so it is not deployed." \
    "$failed" \
    'Fix it and merge again, or pass --skip-checks to deploy it anyway.'
  [ -z "$pending" ] || die "CI is still running on $short." \
    "$pending" \
    'Try again once it has finished, or pass --skip-checks.'

  count=$(printf '%s\n' "$runs" | wc -l | tr -d ' ')
  done_line "All $count checks passed on $short."
fi

if [ "$dry_run" = true ]; then
  step 'Dry run'
  note 'Stopping here. Nothing on the server was changed.'
  printf '\n'
  exit 0
fi

# ── acting ──────────────────────────────────────────────────────────────────

step 'Deploying'
printf '\n'

# --ff-only on purpose: a deploy host that cannot fast-forward has commits of
# its own, and quietly merging them is how a server ends up running something
# no branch describes. It stops instead, and a person looks.
#
# The health wait polls rather than sleeping a fixed while, because a build
# that took ten minutes and one that hit the cache arrive at the same state at
# very different times. A service with no healthcheck of its own is judged on
# being up.
status=0
# shellcheck disable=SC2029,SC2086  # $path is expanded by the remote shell, by design
ssh $ssh_opts "$host" "sh -s -- $path $timeout $backup" <<'REMOTE' || status=$?
set -eu
target=$1
timeout=$2
backup=$3

cd -- "$target"

git pull --ff-only
echo

# The restore point. The entrypoint applies migrations the moment `up` starts
# the new image, and they only go forwards, so the database as it stands now
# is the one thing a bad upgrade cannot give back — and this is the last
# moment it can be copied.
#
# On every deploy, not only when drizzle/ changed: an instance that pulls its
# image gets its migrations from the image, which this checkout does not
# describe, and a database-only dump of an instance this size takes seconds.
# After the pull, so that the script taking it is the one this deploy brings;
# before anything restarts, so that a dump that fails leaves the containers
# running exactly what they ran before.
#
# </dev/null because this script is itself being read from ssh's stdin, and
# anything under it that reads stdin of its own would read the rest of the
# deploy instead. Exit 3 is how the other end tells this apart from a deploy
# that went wrong after something had changed.
restore_point=''
if [ "$backup" = true ]; then
  if ! restore_point=$(./scripts/backup.sh --database-only --keep 10 backups/pre-deploy < /dev/null); then
    echo
    echo "No restore point, so nothing was restarted. The checkout is at"
    echo "$(git log --format='%h' -1); the containers still run what they ran before."
    exit 3
  fi
else
  echo 'No restore point taken: --skip-backup.'
  echo
fi

# An instance that pulls its image rather than building one gets nothing out of
# `up --build`: compose.image.yaml removes the build section, so there is
# nothing to build, and `up` is happy with whatever is already on the host. The
# deploy would restart the code it was already running and report success.
#
# --ignore-buildable is what makes one command right for both: where the app is
# built here it is buildable and skipped, and where it is pulled it is fetched
# first. `app` alone, because the worker names the same image — pulling the tag
# once is what updates both — and because it is the one service that is never
# behind a profile.
docker compose pull --ignore-buildable app
echo

docker compose up -d --build
echo

waited=0
while :; do
  # -a, because a container that exited is dropped from the default listing
  # entirely — a crash loop would otherwise read as "nothing left to wait for".
  ps_lines=$(docker compose ps -a --format '{{.Service}}|{{.State}}|{{.Health}}')

  if [ -z "$ps_lines" ]; then
    pending='no containers are running at all'
  else
    pending=$(
      printf '%s\n' "$ps_lines" | awk -F'|' '
        $2 != "running" || ($3 != "" && $3 != "healthy") {
          line = $1 " (" $2
          if ($3 != "") line = line ", " $3
          print line ")"
        }
      '
    )
  fi

  [ -n "$pending" ] || break

  if [ "$waited" -ge "$timeout" ]; then
    echo
    echo "Gave up waiting after ${timeout}s. Still not ready:"
    printf '%s\n' "$pending" | sed 's/^/  /'
    break
  fi

  if [ "$waited" -eq 0 ]; then
    printf 'Waiting for the containers to report healthy'
  fi
  printf '.'
  sleep 3
  waited=$((waited + 3))
done

if [ "$waited" -gt 0 ]; then
  echo
fi

echo
docker compose ps -a --format 'table {{.Service}}\t{{.Status}}'
echo
echo "Now at $(git log --format='%h %s' -1)"

# Said again at the end, where it is still on screen when it is needed: the
# backup's own output scrolled away under the build.
if [ -n "$restore_point" ]; then
  echo
  echo "Restore point: $restore_point/balancia.dump"
  echo "To go back to it, stop app (and worker), restore, then start the previous release:"
  echo "  docker compose exec -T db pg_restore -U balancia -d postgres --clean --if-exists --create --no-owner < '$restore_point/balancia.dump'"
fi

[ -z "$pending" ] || exit 1
REMOTE

printf '\n'
if [ "$status" -eq 0 ]; then
  done_line "Deployed to $host."
  [ -z "$url" ] || note "$cyan$url$reset"
elif [ "$status" -eq 3 ]; then
  printf '  %s✗%s  %sThe database dump failed, so nothing was restarted.%s\n' "$red" "$reset" "$bold" "$reset"
  note 'Fix what the backup said above and deploy again, or pass --skip-backup'
  note 'to go ahead without a restore point.'
else
  printf '  %s✗%s  %sThe deploy did not finish cleanly.%s\n' "$red" "$reset" "$bold" "$reset"
  note "ssh $host 'cd $path && docker compose logs --tail 50'"
fi
printf '\n'
exit "$status"
