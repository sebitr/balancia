# Rendered email fixtures

Written by `pnpm email:render`, asserted against byte for byte by
`src/modules/auth/emails/templates.test.ts`. Do not edit them by hand: change
the templates or the message catalogues, re-render, and review the diff.

They are excluded from Prettier — reindenting the tables or rewrapping the
inline styles is exactly the drift they exist to catch.

## Provenance

These follow the design handoff's structure, spacing, type scale and copy. Two
things are deliberately not the handoff's:

**Colours come from the theme.** The handoff supplied hand-tuned hex which it
described as converted from the Balancia OKLCH tokens; three of the values were
not, in fact, that conversion. Every colour here is derived from
`src/app/globals.css` instead, with the three roles that have no token of their
own computed by a stated rule. `src/modules/auth/emails/tokens.test.ts` holds
that in place.

**The warning panel points at recovery.** The handoff offers "Change your
password" at a placeholder `https://balancia.app/settings/password`. Balancia
has no change-password screen, and recovery is the better answer anyway: it
mails the address the account still has — the one whoever asked for the change
cannot read — and completing a reset ends every session, which puts them out.
So the panel reads "Reset your password" and points at `/forgot-password`.

The sample tokens and the sample address are the handoff's, kept so the
structure stays diffable against those files.

## What is here

Two languages, six emails, two parts each:

```
en/  fr/
  verify-code-email.html     .txt
  sign-in-code-email.html    .txt
  verify-email.html          .txt
  reset-password-email.html  .txt
  confirm-new-email.html     .txt
  email-change-notice.html   .txt
```

The two code emails have no handoff behind them, so there is nothing to diff
them against — they are rendered because an email nothing renders is an email
whose markup changes unreviewed. They are also the two that link nowhere, which
the tests assert rather than merely observe.

The `.txt` files carry the subject line on the first line, then a blank line,
then the plain-text body — so a copy change shows up in the diff whichever part
it landed in.
