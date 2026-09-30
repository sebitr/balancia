#!/usr/bin/env bash
#
# Reap the worktrees and branches whose pull request has already merged.
#
# Safe by construction. Something is removed only when all of these hold:
#
#   * a pull request from its branch has MERGED on the remote, and the branch
#     is still at the very commit that pull request merged at;
#   * no pull request from a branch of that name is open;
#   * its worktree has no uncommitted changes;
#   * its worktree is not locked by a Claude session that is still running;
#   * it is not the worktree the caller is sitting in.
#
# A branch that never had a pull request is never touched, however old and
# abandoned it looks. That is the rule protecting work in flight: the list of
# merged pull requests is the only thing that authorises a deletion here, so
# without `gh` to fetch it nothing is deleted at all.
#
# And a name is not a pull request. Weblate opens every translation pull
# request from one branch, `weblate-balancia-messages`, and while this matched
# on names alone, #188 having once merged under it was enough to delete each
# new one at the next session start: six pull requests closed unmerged before
# anybody saw why. A branch that has moved on since its pull request merged, or
# been made again under an old name, is somebody's work in flight.
#
# Usage: reap-merged.sh [--dry-run] [--no-remote] [--quiet] [--force]
#
#   --dry-run    say what would go, remove nothing
#   --no-remote  leave the remote branches alone, tidy this machine only
#   --quiet      print only when something actually happened (for hook use)
#   --force      ignore the throttle and run even if it ran recently

set -uo pipefail

DRY_RUN=0; DO_REMOTE=1; QUIET=0; FORCE=0
for arg in "$@"; do
  case "$arg" in
    --dry-run)   DRY_RUN=1 ;;
    --no-remote) DO_REMOTE=0 ;;
    --quiet)     QUIET=1 ;;
    --force)     FORCE=1 ;;
    -h|--help)   sed -n '2,31p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "reap-merged: unknown option $arg" >&2; exit 2 ;;
  esac
done

# Where the caller is standing, resolved before we move to the main checkout.
CALLER_WT=$(git rev-parse --show-toplevel 2>/dev/null || true)

# The first line of `worktree list` is always the main checkout.
ROOT=$(git worktree list --porcelain 2>/dev/null | sed -n '1s/^worktree //p')
[ -n "$ROOT" ] || exit 0
cd "$ROOT" || exit 0

STAMP="$ROOT/.git/reap-merged.stamp"
LOCKDIR="$ROOT/.git/reap-merged.lock"

# Throttle: a session start should not pay for a network round trip every time.
if [ "$FORCE" -eq 0 ] && [ "$DRY_RUN" -eq 0 ] && [ -f "$STAMP" ]; then
  now=$(date +%s); last=$(cat "$STAMP" 2>/dev/null || echo 0)
  [ $(( now - last )) -lt 1800 ] && exit 0
fi

# One reaper at a time; concurrent sessions must not race on the same worktrees.
mkdir "$LOCKDIR" 2>/dev/null || exit 0
trap 'rmdir "$LOCKDIR" 2>/dev/null' EXIT

ACTIONS=""; NOTES=""
act()  { ACTIONS="${ACTIONS}  ${1}"$'\n'; }
note() { NOTES="${NOTES}  ${1}"$'\n'; }

git fetch --prune --quiet 2>/dev/null || true

DEFAULT=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's|^origin/||')
DEFAULT=${DEFAULT:-main}

# The merged set, straight from the forge: for each pull request the branch it
# came from, the number and date it merged under — the two facts a finished
# list item has to carry, out of the call the reaping needed anyway — and the
# commit it merged at, which is what says whether a branch of that name is
# still that pull request. Beside it, the names with a pull request open now.
#
# Both come from `gh`, or nothing is reaped. This used to fall back to the
# branches whose upstream had been deleted, which is what a merged and pruned
# branch looks like from here — and also what a branch deleted by hand looks
# like, or one this script deleted on a name match. That is too little to
# delete somebody's work by, so without the forge they are only named.
MERGED_PRS=""; OPEN=""; FORGE=0
if command -v gh >/dev/null 2>&1 \
   && MERGED_PRS=$(gh pr list --state merged --limit 300 \
                     --json headRefName,number,mergedAt,headRefOid \
                     --jq '.[] | [.headRefName, .number, (.mergedAt | split("T")[0]), .headRefOid] | @tsv' \
                     2>/dev/null) \
   && OPEN=$(gh pr list --state open --limit 300 --json headRefName \
               --jq '.[].headRefName' 2>/dev/null); then
  FORGE=1
fi
if [ "$FORGE" -eq 0 ]; then
  if [ "$QUIET" -eq 0 ]; then
    echo "reap-merged: could not ask GitHub what has merged (no gh, signed out or offline), so nothing was reaped"
    GONE=$(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads \
             | awk '$2=="[gone]" { print "  " $1 }')
    [ -n "$GONE" ] && { echo "upstream deleted, left for you to judge:"; printf '%s\n' "$GONE"; }
  fi
  exit 0
fi
[ -n "$MERGED_PRS" ] || exit 0

# The name says which pull requests to look at; only the commit says whether a
# branch is still one of them. Here-strings rather than a pipe into `grep -q`:
# with a commit on every line the set outgrows a pipe buffer, and an early exit
# on a match would SIGPIPE the writer, which pipefail reports as a miss.
tip()          { git rev-parse --verify --quiet "$1^{commit}" 2>/dev/null; }
named_merged() { awk -F'\t' -v b="$1" '$1 == b { f = 1 } END { exit !f }' <<<"$MERGED_PRS"; }
merged_at()    { awk -F'\t' -v b="$1" -v o="$2" 'o != "" && $1 == b && $4 == o { f = 1 } END { exit !f }' <<<"$MERGED_PRS"; }
has_open()     { grep -Fxq -- "$1" <<<"$OPEN"; }

# Why a branch named after a merged pull request has to stay, or nothing when
# it may go.
held() {
  if has_open "$1"; then
    echo "has an open pull request"
  elif ! merged_at "$1" "$2"; then
    echo "not at the commit its pull request merged at"
  fi
}

# ---- worktrees ------------------------------------------------------------
while IFS=$'\t' read -r wt br locked; do
  [ "$wt" = "$ROOT" ] && continue
  [ -n "$CALLER_WT" ] && [ "$wt" = "$CALLER_WT" ] && continue
  [ -n "$br" ] || { note "$(basename "$wt"): detached HEAD, left alone"; continue; }
  named_merged "$br" || continue
  why=$(held "$br" "$(tip "refs/heads/$br")")
  [ -z "$why" ] || { note "$br: $why, left alone"; continue; }

  if [ -n "$(git -C "$wt" status --porcelain 2>/dev/null)" ]; then
    note "$br: uncommitted changes, left alone"; continue
  fi

  admin=$(git -C "$wt" rev-parse --absolute-git-dir 2>/dev/null)
  if [ -n "$admin" ] && [ -f "$admin/locked" ]; then
    pid=$(sed -n 's/.*pid \([0-9][0-9]*\).*/\1/p' "$admin/locked" | head -1)
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      note "$br: locked by a live session (pid $pid), left alone"; continue
    fi
    [ "$DRY_RUN" -eq 1 ] || git worktree unlock "$wt" >/dev/null 2>&1
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    act "would remove worktree $(basename "$wt") ($br)"
  elif git worktree remove --force "$wt" >/dev/null 2>&1; then
    act "removed worktree $(basename "$wt") ($br)"
  fi
done < <(git worktree list --porcelain | awk '
  /^worktree /{ if (p != "") print p "\t" b "\t" l; p=substr($0,10); b=""; l="" }
  /^branch /  { b=substr($0,8); sub(/^refs\/heads\//,"",b) }
  /^locked/   { l="1" }
  END         { if (p != "") print p "\t" b "\t" l }')

# ---- directories git has forgotten ----------------------------------------
# A worktree deleted by hand, or one whose admin dir was pruned underneath it,
# leaves a full checkout stranded on disk. They are about a gigabyte each, and
# nothing else ever collects them.
for d in "$ROOT"/.claude/worktrees/*/; do
  [ -d "$d" ] || continue
  d=${d%/}
  # Belt and braces: only ever inside this repository's worktree directory.
  case "$d" in "$ROOT"/.claude/worktrees/?*) ;; *) continue ;; esac
  git worktree list --porcelain | grep -Fxq "worktree $d" && continue
  # A live worktree always has a .git file pointing at an admin dir that
  # exists. Both halves missing is what makes this one stranded.
  [ -f "$d/.git" ] || continue
  gd=$(sed -n 's/^gitdir: //p' "$d/.git")
  [ -n "$gd" ] && [ ! -d "$gd" ] || continue
  size=$(du -sh "$d" 2>/dev/null | cut -f1)
  if [ "$DRY_RUN" -eq 1 ]; then
    act "would remove stranded directory $(basename "$d") ($size)"
  elif rm -rf -- "$d"; then
    act "removed stranded directory $(basename "$d") ($size)"
  fi
done

[ "$DRY_RUN" -eq 1 ] || git worktree prune

# ---- local branches -------------------------------------------------------
CURRENT=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
CHECKED_OUT=$(git worktree list --porcelain | sed -n 's|^branch refs/heads/||p')
while read -r br; do
  [ -n "$br" ] || continue
  [ "$br" = "$DEFAULT" ] && continue
  [ "$br" = "$CURRENT" ] && continue
  printf '%s\n' "$CHECKED_OUT" | grep -Fxq -- "$br" && continue
  named_merged "$br" || continue
  why=$(held "$br" "$(tip "refs/heads/$br")")
  [ -z "$why" ] || { note "$br: $why, left alone"; continue; }
  # -D, not -d: a squash merge leaves no ancestry for -d to recognise.
  if [ "$DRY_RUN" -eq 1 ]; then
    act "would delete local branch $br"
  elif git branch -D "$br" >/dev/null 2>&1; then
    act "deleted local branch $br"
  fi
done < <(git for-each-ref --format='%(refname:short)' refs/heads)

# ---- remote branches ------------------------------------------------------
# Since delete_branch_on_merge was turned on this pass usually finds nothing.
# It stays for the backlog, and for a merge made with the setting off.
#
# Each delete carries a lease on the commit it was judged by, so a branch that
# somebody pushed to between the fetch above and this push is refused rather
# than taken. Weblate pushes on its own schedule, not around ours.
if [ "$DO_REMOTE" -eq 1 ]; then
  TO_DELETE=(); LEASES=()
  while read -r br; do
    [ -n "$br" ] || continue
    [ "$br" = "$DEFAULT" ] && continue
    oid=$(tip "refs/remotes/origin/$br") || continue
    why=$(held "$br" "$oid")
    [ -z "$why" ] || { note "origin/$br: $why, left alone"; continue; }
    TO_DELETE+=("$br"); LEASES+=("--force-with-lease=refs/heads/$br:$oid")
  done < <(cut -f1 <<<"$MERGED_PRS" | sort -u)

  if [ ${#TO_DELETE[@]} -gt 0 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      for br in "${TO_DELETE[@]}"; do act "would delete origin/$br"; done
    else
      while IFS=$'\t' read -r flag ref summary; do
        br=${ref##*:refs/heads/}
        case "$flag" in
          -)    act "deleted origin/$br" ;;
          '!')  note "origin/$br: $summary, left alone" ;;
        esac
      done < <(git push --porcelain "${LEASES[@]}" origin --delete "${TO_DELETE[@]}" 2>/dev/null)
    fi
  fi
fi

# ---- the list -------------------------------------------------------------
# `todo/now/` is the set of branches in flight, and AGENTS.md has every chat
# read it before picking work up. An item whose branch has merged is the one
# thing that can make it lie, and it is also the one thing nobody is left to
# catch: filing an item as done wants the merge date and number, which do not
# exist until after the merge, by which time the chat that wrote it has gone.
# So it is said here, by the only thing in the repository that runs after one.
#
# Read off `origin/$DEFAULT` rather than a working tree. The question is
# whether the shared list still claims a merged branch, and the answer must not
# depend on which branch some checkout happens to be parked on.
#
# A notice, never an edit. What to file and when is a person's call. It goes by
# the same identity as the reaping above, judged on origin for the same reason
# the list is: a name reused after its first pull request merged — one with a
# pull request open again, or on origin at a commit that never merged — is in
# flight, and naming its item here would be the list lying the other way.
STALE=""
while read -r item; do
  [ -n "$item" ] || continue
  br=$(git show "origin/$DEFAULT:$item" 2>/dev/null \
         | sed -n 's/^Branch:[[:space:]]*`\([^`]*\)`[[:space:]]*$/\1/p' | head -1)
  [ -n "$br" ] || continue
  named_merged "$br" || continue
  has_open "$br" && continue
  oid=$(tip "refs/remotes/origin/$br")
  [ -n "$oid" ] && ! merged_at "$br" "$oid" && continue
  line=$(awk -F'\t' -v b="$br" -v o="$oid" \
           '$1 == b && (o == "" || $4 == o) { print "Merged: " $3 " in #" $2; exit }' <<<"$MERGED_PRS")
  if [ -n "$line" ]; then
    STALE="${STALE}  $(basename "$item") — $br merged; file it as \"$line\""$'\n'
  else
    STALE="${STALE}  $(basename "$item") — $br merged; file it in todo/done/"$'\n'
  fi
done < <(git ls-tree --name-only "origin/$DEFAULT" todo/now/ 2>/dev/null | grep '\.md$')

[ "$DRY_RUN" -eq 1 ] || date +%s > "$STAMP"

if [ -n "$ACTIONS" ]; then
  echo "reap-merged: pull requests that have merged, tidied away"
  printf '%s' "$ACTIONS"
  [ -n "$NOTES" ] && { echo "left alone:"; printf '%s' "$NOTES"; }
elif [ "$QUIET" -eq 0 ]; then
  echo "reap-merged: nothing to reap"
  [ -n "$NOTES" ] && { echo "left alone:"; printf '%s' "$NOTES"; }
fi

# Said whatever --quiet asked for. A list claiming a branch nobody is on is the
# kind of thing --quiet exists to leave room for, not noise to be spared.
if [ -n "$STALE" ]; then
  echo "reap-merged: todo/now/ still claims a branch whose pull request has merged"
  printf '%s' "$STALE"
  echo "  Filing is a small branch of its own — the merge date does not exist"
  echo "  before the merge. See todo/README.md, \"Moving an item\"."
fi

exit 0
