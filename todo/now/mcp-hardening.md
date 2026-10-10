# Make the MCP server hold against an assistant that has been steered, and say where its changes went

Branch: `fix/mcp-hardening`

A red-team pass over `/mcp` after #465, by hand and by an independent reviewer
who traced every tool to the SQL it runs. No path to a group the account is not
in was found; what was found is in the commit and in `SECURITY.md`.

**Open: a connection that may write to every group can still be steered from one
group into another** (documented in `docs/ai-agents.md`). It is not closed by a
check, because every step is permitted for the account. The choices are to tie
changes to one group, or to refuse a change to any other group for a while after
a group has been read. Decided by the owner, not here.

Not done: marking an assistant's changes as the assistant's in the Activity log
and in the push sent to other members (it needs a column and a line of copy in
both languages); and holding a pinned connection's overview to its own group
rather than computing every group's and returning one.
