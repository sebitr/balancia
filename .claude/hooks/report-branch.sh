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

jq -n --arg c "$context" --arg s "on $branch — $verdict" '{
  systemMessage: $s,
  hookSpecificOutput: {
    hookEventName: "SessionStart",
    additionalContext: $c
  }
}'
