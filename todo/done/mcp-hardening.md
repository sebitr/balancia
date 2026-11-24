# Make the MCP server hold against an assistant that has been steered, and say where its changes went

Merged: 2026-11-24 in #492

A red-team pass over `/mcp` after #465, by hand and by an independent reviewer
who traced every tool to the SQL it runs. No path to a group the account is not
in was found; what was found is in the commit and in `SECURITY.md`.

A second pass added the name fix: an exact name no longer beats a longer one
that starts with or contains it, for members as for groups and for reads as for
changes, so a guest who joins as "Ben" cannot take a repayment meant for "Ben
Carter" and a group called "Lisbon" cannot answer for "Lisbon trip 2026". Every
candidate is listed with its id, and write results name people by id. The same
pass keyed the duplicate lock on what the duplicate check compares, moved it
onto a pool of its own, and folded lookalike letters in the consent screen's
name check.

The integration suites `agent-access-isolation` and `agent-access-routes` were
edited without being run locally; CI is their first run.

**Open: a connection that may write to every group can still be steered from one
group into another** (documented in `docs/ai-agents.md`). It is not closed by a
check, because every step is permitted for the account. The choices are to tie
changes to one group, or to refuse a change to any other group for a while after
a group has been read. Decided by the owner, not here.

Not done: marking an assistant's changes as the assistant's in the Activity log
and in the push sent to other members (it needs a column and a line of copy in
both languages); and holding a pinned connection's overview to its own group
rather than computing every group's and returning one.
