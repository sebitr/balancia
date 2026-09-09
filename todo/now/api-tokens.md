# Give a script, a Shortcut or a wall tablet its own key: named, scoped and revocable

Branch: `feat/api-tokens`

The mobile API had one way in and it was the browser's: a session cookie, minted
by typing a password. Anything that is not a browser — a Shortcut, a cron job, a
tablet on a kitchen wall — had to hold one, which means holding the account.

An API token is the narrow version of that. It is minted on
`/settings/security`, shown once, carries `read` or `write` and may be pinned to
one group, and it is refused outright on the account and the door: no
`/api/auth/*`, no `/api/profile/*`, no `/api/push/*`, no participants, no join
links, no group deletion, and no bulk export — the last for the reason already
written down for guests, that a bearer credential may be forwarded and a
one-request download of a group's whole financial history is a sharper tool in
the wrong hands than the same data read a page at a time.

Two things are worth knowing before touching this:

**A bearer is resolved in the API surface only.** `getCurrentActor()` never
learns about tokens, so no Server Component and no Server Action can be reached
with one — which is also what makes minting and revoking a token impossible to
do _with_ a token, since that screen is Server Actions all the way down.

**The reachable set is an allowlist, not a denylist.** `API_ROUTES` in
`src/modules/api-tokens/scope.ts` names every route template under
`src/app/api/`, and `scope.test.ts` walks the directory and fails the build when
the two disagree. A route added later is refused until somebody says otherwise
in that table, which is the way round this has to fail.
