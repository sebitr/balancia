#!/usr/bin/env bash
#
# Tells a starting session where it actually is: which branch, whether that
# branch is one it may edit, and which other worktrees are live — that last
# part because the sessions clobbering each other could not see each other.
#
# Advisory only. guard-branch.sh does the enforcing; this just means the
# first thing a session learns about its branch is not a denied edit.

set -uo pipefail

command -v jq >/dev/null 2>&1 || exit 0
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || exit 0

root=$(git rev-parse --show-toplevel)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null)
default=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
default=${default#origin/}
default=${default:-main}

track=$(git for-each-ref --format='%(upstream:track)' "refs/heads/$branch" 2>/dev/null)
dirty=$(git status --porcelain 2>/dev/null | grep -c '^' | tr -d ' ')

if [ "$branch" = "HEAD" ]; then
  verdict="BLOCKED — detached HEAD. Edits are refused until you branch."
elif [ "$branch" = "$default" ] || [ "$branch" = "master" ]; then
  verdict="BLOCKED — this is the default branch. Edits are refused until you branch."
elif [ "$track" = "[gone]" ]; then
  verdict="BLOCKED — upstream deleted, so this branch is already merged and finished. Edits are refused until you branch."
else
  verdict="OK to edit."
fi

# Every checkout except this one, so a session can tell that other chats hold
# their own trees rather than assuming it is alone in the repository.
others=$(git worktree list --porcelain 2>/dev/null \
  | awk -v self="$root" '
      /^worktree /   { path=substr($0,10) }
      /^branch /     { b=substr($0,8); sub("refs/heads/","",b);
                       if (path != self) printf "  %s [%s]\n", path, b }
    ')

context="Branch state for this session:
  repository : $root
  branch     : $branch
  uncommitted: $dirty file(s)
  status     : $verdict

One chat, one branch. Do not add unrelated work to a branch another chat
started; prefer EnterWorktree so concurrent chats cannot share a working tree."

if [ -n "$others" ]; then
  context="$context

Other worktrees currently checked out (other chats may be working in these —
leave their files alone):
$others"
fi

# Work that exists on this machine only and has not moved for a week. The
# reaper never touches a branch that never had a pull request, which is right,
# and it never mentions one either, which is how a security fix sat unpushed
# for six weeks while the code it fixed was live, and an uncommitted bug fix
# sat in a worktree for two months. Naming it is all this does.
STALE_DAYS=${REPORT_STALE_DAYS:-7}
now=$(date +%s)
cutoff=$((now - STALE_DAYS * 86400))

# Candidates first, from one for-each-ref: no upstream, and quiet for a week.
# Then a single rev-list says which of their tips no remote has; a branch per
# rev-list made this hook take seconds on a repository with forty branches.
candidates=$(git for-each-ref --format='%(objectname) %(refname:short) %(upstream) %(committerdate:unix) %(committerdate:short)' refs/heads 2>/dev/null \
  | awk -v main="$default" -v cutoff="$cutoff" \
      'NF == 4 && $2 != main && $3 < cutoff { print $1, $2, $4 }')
unpushed=""
if [ -n "$candidates" ]; then
  stranded=$(printf '%s\n' "$candidates" | awk '{print $1}' \
    | git rev-list --stdin --not --remotes 2>/dev/null | sort -u)
  unpushed=$(printf '%s\n' "$candidates" | while read -r sha name day; do
      printf '%s\n' "$stranded" | grep -qx "$sha" || continue
      printf "  %s (last commit %s)\n" "$name" "$day"
    done)
fi

# A worktree whose uncommitted changes nobody has touched for a week. Judged
# by the files themselves, since nothing was committed to carry a date.
idle=$(git worktree list --porcelain 2>/dev/null \
  | awk '/^worktree /{print substr($0,10)}' \
  | while read -r tree; do
      [ -d "$tree" ] || continue
      changed=$(git -C "$tree" status --porcelain --untracked-files=all 2>/dev/null \
        | sed -e 's/^...//' -e 's/.* -> //')
      [ -n "$changed" ] || continue
      newest=$(printf '%s\n' "$changed" \
        | (cd "$tree" && perl -ne 'chomp; my $m = (stat $_)[9]; print "$m\n" if defined $m') \
        | sort -n | tail -1)
      [ -n "$newest" ] || continue
      [ "$newest" -lt "$cutoff" ] || continue
      count=$(printf '%s\n' "$changed" | grep -c '^')
      printf "  %s (%s uncommitted file(s), untouched since %s)\n" "$tree" "$count" \
        "$(perl -e 'my @t = localtime shift; printf "%04d-%02d-%02d", $t[5]+1900, $t[4]+1, $t[3]' "$newest")"
    done)

if [ -n "$unpushed$idle" ]; then
  context="$context

Work on this machine only, unchanged for $STALE_DAYS days or more. Nothing
removes it and no pull request tracks it. Tell the person it is here; do not
push, commit, delete or continue it without their word:"
  [ -n "$unpushed" ] && context="$context
Branches never pushed:
$unpushed"
  [ -n "$idle" ] && context="$context
Worktrees with uncommitted changes:
$idle"
fi

jq -n --arg c "$context" --arg s "on $branch — $verdict" '{
  systemMessage: $s,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $c
  }
}'
