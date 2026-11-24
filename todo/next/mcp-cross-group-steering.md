# Decide how an assistant allowed to write to every group is kept from being steered from one group into another

See: `docs/ai-agents.md`, `todo/done/mcp-hardening.md`

A connection that may write to every group the account is in can read text a member typed in one group and be talked into a change in another. No single check refuses it, because every step is permitted for the account. The two choices on the table are to tie a connection's changes to one group, or to refuse a change to any other group for a while after a group has been read. It is the owner's decision, not an implementation detail.
