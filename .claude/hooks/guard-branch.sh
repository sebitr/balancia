#!/usr/bin/env bash
#
# Refuses edits while the session sits on a branch that work must not
# accumulate on: the default branch, a detached HEAD, or a branch whose
# upstream has been deleted (which on this repository means its pull request
# was merged and the branch is finished).
#
# The failure this prevents is not hypothetical. Four unrelated features —
# data export, participant names, the dashboard rewrite and an auth fix —
# were once found stacked in a single working tree on feat/docker-dev-env,
# itself already merged, because each new chat inherited whatever branch the
# previous one had left checked out and simply carried on.
#
# Reads the PreToolUse payload on stdin, writes a permission decision on
# stdout. Anything unexpected — no jq, not a repository, a path outside the
# repository — allows the edit: a guard that blocks work when its own
# assumptions fail is worse than the accidents it prevents.

set -uo pipefail

allow() { printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow"}}\n'; exit 0; }

deny() {
  # jq -Rs quotes the reason for us: it spans several lines and names a branch
  # whose text we do not control.
  printf '%s' "$1" | jq -Rs '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: .
    }
  }'
  exit 0
}

command -v jq >/dev/null 2>&1 || allow

payload=$(cat)
file=$(printf '%s' "$payload" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')
[ -n "$file" ] || allow

# Resolve against the directory the file lives in, not the process working
# directory, so a session running inside a worktree is judged on that
# worktree's HEAD rather than the main checkout's.
dir=$(dirname -- "$file")
while [ ! -d "$dir" ] && [ "$dir" != "/" ] && [ "$dir" != "." ]; do dir=$(dirname -- "$dir"); done
[ -d "$dir" ] || allow

git -C "$dir" rev-parse --is-inside-work-tree >/dev/null 2>&1 || allow

branch=$(git -C "$dir" rev-parse --abbrev-ref HEAD 2>/dev/null) || allow
root=$(git -C "$dir" rev-parse --show-toplevel 2>/dev/null)

# Editing the guard's own configuration has to stay possible, or a mistake
# here can only be undone by hand. Worktrees live under .claude/ too and are
# ordinary code, so they are matched first and judged on their own branch.
case "$file" in
  */.claude/worktrees/*) ;;
  */.claude/*) allow ;;
esac

escape_hatch="Start an isolated worktree for this chat with the EnterWorktree tool — it
branches from origin/main, so you get a clean base rather than whatever the
last chat left behind. If this work genuinely belongs in the main checkout,
cut a branch instead:

    git -C \"$root\" switch -c <type>/<topic> origin/main

Nothing here blocks a branch you have made yourself."

default=$(git -C "$dir" symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
default=${default#origin/}
default=${default:-main}

if [ "$branch" = "HEAD" ]; then
  deny "This session is on a detached HEAD in $root, where commits belong to no
branch and are lost at the next checkout.

$escape_hatch"
fi

if [ "$branch" = "$default" ] || [ "$branch" = "master" ]; then
  deny "This session is on $branch, the default branch of $root. Work committed
here cannot be reviewed as a pull request, and it mixes with whatever another
chat is doing in the same checkout.

$escape_hatch"
fi

track=$(git -C "$dir" for-each-ref --format='%(upstream:track)' "refs/heads/$branch" 2>/dev/null)
if [ "$track" = "[gone]" ]; then
  deny "This session is on $branch, whose upstream branch has been deleted — on
this repository that means its pull request was already merged and the branch
is finished. Adding to it now stacks new work on top of code that is already
in main, which is how four unrelated features once ended up in one commit.

$escape_hatch"
fi

allow
