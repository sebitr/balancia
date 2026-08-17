# Rendered email fixtures

Written by `pnpm email:render`, asserted against byte for byte by
`src/modules/auth/emails/templates.test.ts`. Do not edit them by hand: change
the templates or the message catalogues, re-render, and review the diff.

They are excluded from Prettier — reindenting the tables or rewrapping the
inline styles is exactly the drift they exist to catch.

## Provenance

The English files reproduce the design handoff's reference HTML.
`reset-password-email.html`, `verify-email.html` and `confirm-new-email.html`
are byte-identical to it.

`email-change-notice.html` differs in one place, deliberately. The reference
offers "Change your password" pointing at a placeholder
`https://balancia.app/settings/password`. Balancia has no change-password
screen, and password recovery is the better answer anyway: it mails the address
the account still has — the one whoever asked for the change cannot read — and
completing a reset ends every session, which puts them out. So the panel reads
"Reset your password" and points at `/forgot-password`.

The sample tokens and the sample address are the handoff's, kept so these stay
diffable against those files.

## What is here

Two languages, four emails, two parts each:

```
en/  fr/
  verify-email.html          .txt
  reset-password-email.html  .txt
  confirm-new-email.html     .txt
  email-change-notice.html   .txt
```

The `.txt` files carry the subject line on the first line, then a blank line,
then the plain-text body — so a copy change shows up in the diff whichever part
it landed in.
