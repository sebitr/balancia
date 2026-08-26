#!/usr/bin/env bash
#
# Installs dependencies into a worktree that arrived without any.
#
# A fresh worktree has no node_modules, so without this the first thing a
# parallel chat meets is a failing test run. Six seconds, because pnpm hard
# links out of its content-addressed store rather than copying.
#
# This was registered as a WorktreeCreate hook until that was found breaking
# every EnterWorktree in this repository. WorktreeCreate is not a notification
# that a worktree appeared: it is how a repository *creates* one. The hook is
# handed a name, has to make the directory itself and print its absolute path
# as the last line of stdout, and registering one turns off the built-in
# `git worktree add` entirely — that is the point of it, since it is what lets
# a jj or Sapling checkout stand in for a git worktree. A script that only
# installed dependencies therefore disabled the built-in creation and then
# answered with no path, so every EnterWorktree failed with
#
#     WorktreeCreate hook failed: hook succeeded but returned no worktree path
#
# and every chat fell back to `git switch -c` in the one main checkout — which
# is how a second chat's staged work was found in the shared index, one
# `git commit --amend` away from an unrelated commit.
#
# The post-create event this wanted all along is PostToolUse matching
# EnterWorktree: it fires once the worktree exists, and its payload carries
# tool_response.worktreePath. SessionStart covers the ways a session can reach
# a worktree without calling the tool — `claude --worktree`, agent isolation,
# or simply being resumed inside one.
#
# Neither CwdChanged nor a plain SessionStart would do: EnterWorktree moves the
# running session rather than restarting it, and the cwd watcher only wakes for
# a shell changing directory, so both stay silent exactly when a worktree is
# created. Letting Claude Code keep ownership of creation is worth the care —
# it is what honours worktree.baseRef, holds the liveness lock that stops two
# chats sharing a checkout, and lets ExitWorktree remove the tree afterwards
# without demanding discard_changes.
#
# node_modules is deliberately NOT shared between worktrees. pnpm rewrites it
# to match the branch it is told to install — switching branches in this repo
# was observed removing a dependency another branch needed — so one shared
# copy would put the worktrees back in each other's way, which is the whole
# thing they exist to prevent.

set -uo pipefail

payload=$(cat 2>/dev/null || true)

# tool_response.worktreePath is the worktree EnterWorktree just made; .cwd is
# where a session already sits. Never .worktree_path — that field belongs to
# WorktreeRemove, and asking for it here is what used to point the install at
# the main checkout.
dir=""
if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
  dir=$(printf '%s' "$payload" | jq -r '.tool_response.worktreePath // .cwd // empty' 2>/dev/null)
fi
[ -n "$dir" ] && [ -d "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"

[ -f "$dir/package.json" ] || exit 0

# Idempotent on purpose: both events can name a tree that already has its
# dependencies, and the main checkout always does.
[ ! -d "$dir/node_modules" ] || exit 0

# A host with no pnpm is not a broken one. This repository's dev stack runs
# node inside Docker, and such a host keeps node_modules in a volume rather
# than in the tree — there is nothing to install here.
command -v pnpm >/dev/null 2>&1 || exit 0

# Backgrounded: entering a worktree should not sit and wait on a package
# manager, and the log is there when a run does fail. nohup and a closed stdin,
# because the hook's own process goes away as soon as it returns.
log="$dir/.worktree-install.log"
nohup sh -c 'cd "$1" && pnpm install --prefer-offline >"$1/.worktree-install.log" 2>&1' \
  _ "$dir" </dev/null >/dev/null 2>&1 &
disown 2>/dev/null || true

printf '{"systemMessage":"No node_modules in %s — installing in the background (pnpm install, ~6s; log at %s)."}\n' \
  "$dir" "$log"
