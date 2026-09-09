# Changing a password signs out the other devices, and three smaller hardenings

Merged: 2026-09-08 in #322

From a security audit of the whole tree. Four findings, one branch, because
they are one topic — what the audit turned up — rather than four features.

The one that mattered: `changePassword` re-hashed and stopped, so the session
somebody was trying to evict kept working for the rest of its thirty days. With
no device list anywhere in the app, the only remedy was to sign out and use the
forgotten-password flow, which is the opposite of what anybody would guess.
`revokeAllSessionsForUser` had carried an unused `exceptSessionId` parameter for
exactly this since it was written.

The other three: no schema on `sendReminderAction`, the only action input that
parsed nothing; push endpoints accepted any HTTPS URL including
`169.254.169.254`, which the doc comment above the schema had claimed was
refused for a long time without anything implementing it; and two response
headers worth a line each.

What is deliberately _not_ here: DNS rebinding on the push endpoint. Closing it
needs the address checked after resolution and pinned for the connection — a
custom dispatcher rather than a predicate — and the residual is a blind POST
with no cookies, no redirects and no response body reaching the subscriber.
Noted in `src/lib/security/internal-hosts.ts` so the next person does not have
to re-derive it.
