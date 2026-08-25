# Transactional emails

Balancia sends six emails, all of them about getting into an account or
changing which address one belongs to. There is no marketing mail, no digest
and no list to unsubscribe from, which is why none of them carries a footer or
a postal address.

| Email                     | Sent when                                      | To                              |
| ------------------------- | ---------------------------------------------- | ------------------------------- |
| Welcome / confirm address | An account is registered with a password       | The new account's address       |
| Verification code         | An account is created from the onboarding flow | The new account's address       |
| Sign-in code              | Someone with no password asks to sign in       | The account's address           |
| Password reset            | Someone asks to recover an account             | The account's address           |
| Change of address notice  | An email change is requested                   | The address the account **has** |
| Confirm new address       | An email change is requested                   | The address it is moving **to** |

The two code emails are the odd ones out: they contain six digits and no link
at all, and that is deliberate. An email that asks for a code _and_ offers a
button teaches the reader that both are normal, which is the habit a phishing
mail relies on. The digits are set in the serif face at display size, because
it is the one face in the set with unambiguous figures — a 1 that reads as a 7
costs somebody their account. Codes last ten minutes, are single-use, and are
checked only against the account they were issued for; see `docs/architecture.md`
and `src/modules/auth/codes.ts`.

The last two are a pair: one request sends both. The notice goes first, so a
delivery failure stops the request before a confirmation link is out in the
world. See `requestEmailChange` in `src/modules/auth/service.ts`.

None of them is sent on an instance with no SMTP configured, because none of
the flows behind them is offered there.

## Getting the code out of the email

There is no copy button, and there cannot be one. A copy button needs the
clipboard, the clipboard needs JavaScript, and a mail client runs none. What
the two code emails do instead is two things, neither of which is a button:

- **The digits sit in a panel that `user-select:all` selects whole.** One tap
  on a phone or one click on a desktop makes the six figures the selection, so
  the reader presses copy rather than dragging a caret across characters they
  are trying not to misread. What lands on the clipboard is the six figures —
  the letter-spacing is a rendering, not a character. Clients that strip the
  property lose nothing but the shortcut.
- **The message is shaped so the phone offers the code itself.** iOS and
  Android surface a one-time code to the keyboard when they find one beside a
  word like "code". So the subject leads with the digits, the panel's own label
  carries the word immediately above them, and the plain-text part names both
  in its first sentence.

That second point is also why no code email may contain another number. The
closing line used to read "expires in 10 minutes", which put a second candidate
beside the same keyword — the reliable way to be offered the wrong one. It now
spells the duration out, and `templates.test.ts` fails on any digit in a code
email that is not the code.

## Where they live

```
src/modules/auth/emails/
  tokens.ts      the palette and the font stacks, derived from the theme
  layout.ts      the shared skeleton: card, header bar, button, panels
  templates.ts   the six emails, as arrangements of that skeleton
src/lib/color/oklch.ts  OKLCH → sRGB, and the contrast maths
messages/{en,fr}.json   every word, under `emails.*`
public/email/mark.png   the header mark, written by `pnpm icons`
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

- **One image, and the header survives without it.** The Balancia mark is a
  PNG served from the instance's own origin, because Gmail and Outlook drop
  inline SVG and strip `data:` URIs. The wordmark beside it stays live text, so
  a client with images off — which is most of them, on first open — still shows
  a branded bar. The mark is therefore decorative and carries an empty `alt`;
  giving it `alt="Balancia"` would make a screen reader say the name twice.
- **No web fonts.** Arial stands in for Instrument Sans, Georgia for Instrument
  Serif. The tight letter-spacing on large text is what carries the typography
  across the substitution.
- **No JavaScript, no external stylesheets, and nothing fetched from a third
  party.** The only request an email makes is for the mark, from the same
  origin its links point at. This is what rules out a copy button; see
  [Getting the code out of the email](#getting-the-code-out-of-the-email).
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
`tokens.ts` holds literal hex. Every value is nonetheless derived from
`src/app/globals.css` rather than chosen, and `tokens.test.ts` re-derives all
of them on every run — move a token and the test names the constant that no
longer follows from it.

Most are a straight conversion of the light theme's token. Three are computed,
because the role has no token of its own:

| Value             | Rule                                                                |
| ----------------- | ------------------------------------------------------------------- |
| `link`            | `--primary`, darkened until 14px text on the cream panel reaches AA |
| `destructiveTint` | `--destructive` at 8% over `--card`                                 |
| `destructiveInk`  | `--destructive`, darkened to AAA on that tint                       |

Only lightness moves; hue and chroma are left alone, so what comes out is
recognisably the token rather than a second colour that happens to pass. Coral
at `--primary` is a fill — as body copy on white it is 2.8:1 — which is why
`link` exists and why raw coral never carries text.

The same file also asserts WCAG AA for every text-on-background pairing the
emails actually use, so "darkened until it passes" stays true rather than
becoming a comment about something that used to be the case.

## Testing before a release

The fixtures and the unit tests catch drift, not rendering. Before shipping a
change to the markup, put the rendered files through Litmus or Email on Acid,
at minimum on: Gmail web, Gmail iOS and Android, Apple Mail on macOS and iOS,
Outlook 2016/2019 on Windows, Outlook.com, and Yahoo. On the two code emails,
check the tap-to-select panel by hand on a real iPhone and a real Android
handset — whether `user-select` survives a client's sanitiser is not something
a fixture can tell you, and neither is whether the keyboard offers the code. Check Apple Mail dark and
Outlook.com dark specifically — the palette was chosen to survive client-side
inversion, and that is the assumption most worth re-checking.

Each file is around 6KB. Gmail clips a message at roughly 100KB, which would cut
the button off the bottom; the tests fail well before that.

Check the header with images blocked, too. It should read as a plum bar with
"Balancia" in it, missing only the mark.

## Local delivery

`compose.dev.yaml` runs Mailpit, which accepts anything and delivers nowhere.
Its inbox is at <http://localhost:8025>, and nothing sent from a development
stack leaves the host.
