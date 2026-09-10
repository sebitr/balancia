# File #343's item, and have the reaper say when `todo/now/` is claiming a branch that has already merged

Branch: `chore/file-settle-method-row`

`todo/now/settle-method-row.md` had been sitting there since #343 merged on
2026-09-09, so `now/` was again claiming a branch that exists neither on the
remote nor on this machine. It moves to `todo/done/` as
`Merged: 2026-09-09 in #343`.

The third time in two days is the part worth fixing. #338 filed twenty-three
items at once, #344 filed two more, and this one went stale the same day its
pull request merged. AGENTS.md says filing happens "as part of the change, in
the same commit", and for the `done/` half that instruction cannot be followed:
`Merged: <date> in #<pr>` wants two facts that do not exist until after the
merge, by which time the chat that wrote the item has gone. The doctrine asks
for something impossible and then leaves the rest to goodwill, which is why it
keeps failing.

`src/lib/todo-list.test.ts` cannot cover it. Whether a branch has merged is a
fact about the forge, not about the tree, and the only local proxy —
`refs/remotes/origin/<branch>` — is wrong exactly where it would run:
`actions/checkout` fetches one branch at depth 1, so in CI those refs hold
`main` and nothing else, and every `now/` item would read as stale. Offline, a
stale fetch says the same. A unit test that needs the network to be right is
not a unit test.

`.claude/hooks/reap-merged.sh` is where it belongs instead. It is the one thing
in the repository that runs _after_ a merge, it already asks the forge for the
merged set in order to reap by it, and widening that one call to carry each
pull request's number and date costs no extra round trip and hands the notice
the exact `Merged:` line to write. It reads the list off `origin/main` rather
than a working tree, so the answer does not depend on which branch a checkout
happens to be parked on, and it only ever prints — rewriting somebody's list
entry is not a hook's business.
