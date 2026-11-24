# Compute a pinned assistant connection's overview from its own group only

See: `src/app/mcp/read-tools.ts`, `todo/done/mcp-hardening.md`

A connection pinned to one group asks for an overview, and the server computes every group's balances before returning the one it may see. The answer is right, but the work is the whole account's; it should load the pinned group alone.
