# Label what group members typed in every assistant answer, speak split errors in money, and say when Balancia does call an AI service

Merged: 2026-11-24 in #502

Follow-ups to the MCP hardening in #492. Every tool result and every error
that quotes a name now says the text was typed by group members, from one
place in `src/app/mcp/support.ts`. A split or payer total that does not add up
is told in the expense's currency rather than in minor units. The claim that
Balancia calls no AI service is qualified for an instance that reads receipts
on the server. Changing a password now ends the account's assistant
connections, as a reset already did.

`/llms.txt` still describes `/mcp` on an instance with `AGENT_ACCESS` off: the
comment on `homeQuestions` says the llms files describe the software rather
than the instance, so gating it is left to the owner.

The integration suites `agent-access-routes` and `agent-access` were edited
without being run locally; CI is their first run.
