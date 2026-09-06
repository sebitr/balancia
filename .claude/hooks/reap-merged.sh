#!/usr/bin/env bash
#
# Reap the worktrees and branches whose pull request has already merged.
#
# Safe by construction. Something is removed only when all of these hold:
#
#   * its branch has a MERGED pull request on the remote;
#   * its worktree has no uncommitted changes;
#   * its worktree is not locked by a Claude session that is still running;
#   * it is not the worktree the caller is sitting in.
#
# A branch that never had a pull request is never touched, however old and
# abandoned it looks. That is the rule protecting work in flight: the list of
# merged pull requests is the only thing that authorises a deletion here.
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
    -h|--help)   sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
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

# The merged set, straight from the forge. Without `gh` we fall back to the
# branches whose upstream has been deleted, which is what a merged-and-pruned
# branch looks like from here.
MERGED=""
if command -v gh >/dev/null 2>&1; then
  MERGED=$(gh pr list --state merged --limit 300 --json headRefName \
             --jq '.[].headRefName' 2>/dev/null)
fi
if [ -z "$MERGED" ]; then
  MERGED=$(git for-each-ref --format='%(refname:short) %(upstream:track)' refs/heads \
             | awk '$2=="[gone]"{print $1}')
  [ -n "$MERGED" ] && note "no gh: falling back to branches whose upstream is gone"
fi
[ -n "$MERGED" ] || exit 0

is_merged() { printf '%s\n' "$MERGED" | grep -Fxq -- "$1"; }

# ---- worktrees ------------------------------------------------------------
while IFS=$'\t' read -r wt br locked; do
  [ "$wt" = "$ROOT" ] && continue
  [ -n "$CALLER_WT" ] && [ "$wt" = "$CALLER_WT" ] && continue
  [ -n "$br" ] || { note "$(basename "$wt"): detached HEAD, left alone"; continue; }
  is_merged "$br" || continue

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
  is_merged "$br" || continue
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
if [ "$DO_REMOTE" -eq 1 ]; then
  TO_DELETE=()
  while read -r br; do
    [ -n "$br" ] || continue
    [ "$br" = "$DEFAULT" ] && continue
    git show-ref --verify --quiet "refs/remotes/origin/$br" || continue
    TO_DELETE+=("$br")
  done < <(printf '%s\n' "$MERGED" | sort -u)

  if [ ${#TO_DELETE[@]} -gt 0 ]; then
    if [ "$DRY_RUN" -eq 1 ]; then
      for br in "${TO_DELETE[@]}"; do act "would delete origin/$br"; done
    elif git push origin --delete "${TO_DELETE[@]}" >/dev/null 2>&1; then
      for br in "${TO_DELETE[@]}"; do act "deleted origin/$br"; done
    fi
  fi
fi

[ "$DRY_RUN" -eq 1 ] || date +%s > "$STAMP"

if [ -n "$ACTIONS" ]; then
  echo "reap-merged: pull requests that have merged, tidied away"
  printf '%s' "$ACTIONS"
  [ -n "$NOTES" ] && { echo "left alone:"; printf '%s' "$NOTES"; }
elif [ "$QUIET" -eq 0 ]; then
  echo "reap-merged: nothing to reap"
  [ -n "$NOTES" ] && { echo "left alone:"; printf '%s' "$NOTES"; }
fi
exit 0
