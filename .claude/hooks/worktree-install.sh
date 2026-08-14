#!/usr/bin/env bash
#
# Installs dependencies into a newly created worktree.
#
# A fresh worktree has no node_modules, so without this the first thing any
# parallel chat meets is a failing test run. Six seconds, because pnpm hard
# links out of its content-addressed store rather than copying.
#
# node_modules is deliberately NOT shared between worktrees. pnpm rewrites it
# to match the branch it is told to install — switching branches in this repo
# was observed removing a dependency another branch needed — so one shared
# copy would put the worktrees back in each other's way, which is the whole
# thing they exist to prevent.

set -uo pipefail

payload=$(cat 2>/dev/null || true)

dir=""
if command -v jq >/dev/null 2>&1 && [ -n "$payload" ]; then
  dir=$(printf '%s' "$payload" | jq -r '.worktree_path // .worktree.path // .path // .cwd // empty' 2>/dev/null)
fi
[ -n "$dir" ] && [ -d "$dir" ] || dir="${CLAUDE_PROJECT_DIR:-$PWD}"
[ -f "$dir/package.json" ] || exit 0

command -v pnpm >/dev/null 2>&1 || exit 0

# Backgrounded: worktree creation should not sit and wait on a package
# manager, and the log is there when a run does fail.
log="$dir/.worktree-install.log"
( cd "$dir" && pnpm install --prefer-offline >"$log" 2>&1 ) &

printf '{"systemMessage":"Installing dependencies in the new worktree (pnpm install, ~6s)"}\n'
