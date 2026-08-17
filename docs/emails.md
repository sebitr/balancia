# Transactional emails

Balancia sends four emails, all of them about getting into an account or
changing which address one belongs to. There is no marketing mail, no digest
and no list to unsubscribe from, which is why none of them carries a footer or
a postal address.

| Email                     | Sent when                          | To                              |
| ------------------------- | ---------------------------------- | ------------------------------- |
| Welcome / confirm address | An account is registered           | The new account's address       |
| Password reset            | Someone asks to recover an account | The account's address           |
| Change of address notice  | An email change is requested       | The address the account **has** |
| Confirm new address       | An email change is requested       | The address it is moving **to** |

The last two are a pair: one request sends both. The notice goes first, so a
delivery failure stops the request before a confirmation link is out in the
world. See `requestEmailChange` in `src/modules/auth/service.ts`.

None of them is sent on an instance with no SMTP configured, because none of
the flows behind them is offered there.

## Where they live

```
src/modules/auth/emails/
  tokens.ts      the palette and the font stacks
  layout.ts      the shared skeleton: card, header bar, button, panels
  templates.ts   the four emails, as arrangements of that skeleton
messages/{en,fr}.json   every word, under `emails.*`
tests/fixtures/emails/  the rendered output, checked in
```

`templates.ts` holds no copy and `layout.ts` holds no arrangement. A wording
change is a catalogue change; a design change is a layout change; which
paragraph goes where is the middle file.

## Changing one

```bash
pnpm email:render
```

That rewrites `tests/fixtures/emails` for both languages and prints where it
put them. The template tests assert the rendered output equals those files, so
the workflow is: edit, render, read the diff, commit it. A change you did not
intend shows up as a fixture diff rather than as a differently-shaped email
nobody notices for a month.

To look at one, render somewhere else and open it:

```bash
pnpm email:render /tmp/emails
```

That is a first pass, not a test. A browser is far more forgiving than Outlook.

## Why the markup looks like 1999

Tables for layout, every style inlined, explicit widths on everything, and
`mso-line-height-rule:exactly` on every piece of text. This is not legacy code
that nobody has got round to modernising — it is what the Outlook Word engine
and Gmail's HTML sanitiser require. Rewriting it into flexbox breaks the email
in the clients most likely to be reading it.

The specifics:

- **No images.** The wordmark is live text and the brand dot is a `<div>`, so
  image blocking cannot erase the header. In Outlook the dot renders square;
  that is accepted.
- **No web fonts.** Arial stands in for Instrument Sans, Georgia for Instrument
  Serif. The tight letter-spacing on large text is what carries the typography
  across the substitution.
- **No JavaScript, no external stylesheets.** Both are stripped, and their
  presence counts against deliverability.
- **The `<head>` block carries only media queries and the link colour.** Several
  clients drop it outright, so nothing that positions or colours an element may
  live there. Everything else is inlined on the element it styles.
- **Buttons are a padded `<td bgcolor>` with an `<a display:block>` filling it.**
  Never an `<img>`, never a `<button>`.
- **Every message has a plain-text part** carrying the same information in the
  same order, with each URL on its own line. It is not a summary.

`src/modules/auth/emails/templates.test.ts` asserts all of that, per email and
per language, so a well-meaning modernisation fails in CI.

## Colours

Email clients support neither `oklch()` nor CSS custom properties, so
`tokens.ts` is the one place in the codebase where a colour is written a second
time. If a token in `src/app/globals.css` moves, move the matching value there
by hand.

Three of the values are not a straight conversion of their token, and the
difference is deliberate — a near-grey secondary and a lighter destructive both
read badly through a mail client's own contrast handling, and the link colour is
`--primary` darkened until body text on the light fills meets WCAG AA. Raw coral
does not, so it is never used for text. The reasoning is in `tokens.ts`.

## Testing before a release

The fixtures and the unit tests catch drift, not rendering. Before shipping a
change to the markup, put the rendered files through Litmus or Email on Acid,
at minimum on: Gmail web, Gmail iOS and Android, Apple Mail on macOS and iOS,
Outlook 2016/2019 on Windows, Outlook.com, and Yahoo. Check Apple Mail dark and
Outlook.com dark specifically — the palette was chosen to survive client-side
inversion, and that is the assumption most worth re-checking.

Each file is around 6KB. Gmail clips a message at roughly 100KB, which would cut
the button off the bottom; the tests fail well before that.

## Local delivery

`compose.dev.yaml` runs Mailpit, which accepts anything and delivers nowhere.
Its inbox is at <http://localhost:8025>, and nothing sent from a development
stack leaves the host.
