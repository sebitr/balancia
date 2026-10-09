# Connect an AI agent: add Balancia to Claude or ChatGPT by its address and manage groups by talking to it

Merged: 2026-10-09 in #465

A remote MCP server at `/mcp` (Streamable HTTP, stateless), with Balancia as
its own OAuth 2.1 authorization server so the one-step "add a connector" flow in
Claude and ChatGPT works, and the existing API keys accepted there for clients
that take a header. See `docs/ai-agents.md`.

Settings → AI assistants (`/settings/assistants`) lists what is connected and
carries the guide: the address to copy, the steps for Claude, ChatGPT, Claude
Code and editors, what to ask, how to stay in control, and what to do when it
does not work. It is hidden, row and screen both, where `AGENT_ACCESS` is off.
