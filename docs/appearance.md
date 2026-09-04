# Appearance

How Balancia looks is three decisions, kept in three places. This page says
which is which, and why the colours that mean money never move with any of
them.

## The three decisions

| Decision         | Choices                                              | Kept                                   |
| ---------------- | ---------------------------------------------------- | -------------------------------------- |
| **Theme**        | Auto (follow the system), Light, Dark                | In the browser (`localStorage`)        |
| **Dark surface** | Plum or Midnight                                     | Cookie on this device                  |
| **Accent**       | Coral, Amber, Mint, Ocean, Lavender, Raspberry, Plum | Cookie, and the account when signed in |

The theme is applied by a script that runs before the first paint, so a dark
page never flashes light. The dark surface and the accent are read by the
server and written onto `<html>` in its own HTML — an attribute for the first,
inline variables for the second — for the same reason: a page that changes
colour under the reader once per visit is worse than one that takes a moment
to follow them to a new device.

The dark surface belongs to the device rather than the account, the way the
theme does: the phone that wants Midnight for its OLED panel is not the laptop
it syncs with. The accent is a taste, so it follows the account — sign in on a
new device and it is there.

There were two more. A **light surface**, Cream or Paper, went because a
warmer or a cooler white is a preference with nothing behind it, where an OLED
panel is a battery. A **contrast** choice went because it was a worse copy of
a setting the reader already has; see below.

## The dark surface

**Plum** is the dark theme as drawn. **Midnight** takes it down to where an
OLED panel goes black. Midnight is a short block of overrides near the bottom
of `src/app/globals.css`, applied when `<html>` carries
`data-dark="midnight"`; Plum carries no attribute, so a document nobody
painted is the cream-and-plum one.

The light palette is cream, and is not a choice.

## Contrast

Increased contrast darkens captions, strengthens borders and takes every
balance figure and link from 4.5:1 to 7:1 against the page. It applies
whenever the system asks for more contrast (`prefers-contrast: more`) and at
no other time — a media query in `globals.css`, with no cookie, no pre-paint
script and no way for the page to disagree with the platform.

This used to be a three-way control (Auto, Standard, Increased). Removing it
does take something away: a reader who wanted 7:1 without turning it on for
their whole system no longer can. `prefers-contrast: more` maps to
"Increase contrast" on macOS and iOS and to High Contrast on Windows, so the
gap is small, and a setting that can silently disagree with the platform's own
is worse than not having one.

A device that still carries the retired `balancia_light` or
`balancia_contrast` cookie is not read from it and not troubled by it.

## The accent, and the money colours

Green means somebody owes you, red means you owe, amber marks who paid. Those
three are the only colours in the app that carry meaning, and **they are the
same on every account, whichever accent is chosen.** A balance is the same red
for everyone, which is the point of a colour that means something.

For a while they were not. Three of the seven accents sit on a money colour —
coral, the default, is two degrees from the "you owe" red; mint is the "gets
back" green exactly; amber is the payer — so each money hue was rotated away
from the accent until it was forty degrees clear. That gave a coral reader a
ruby "you owe", a mint reader an olive "gets back" and an amber reader a
chartreuse payer.

It turned out the rule could not be satisfied and look like anything. In the
dark theme the accents and the money fills sit in the same lightness band, and
a colour used as text is darkened (or lightened) until it reads at 4.5:1 — so
two of them end up at the same lightness whatever hue they started from. Hue
is then the only thing left to tell them apart, and it takes about thirty
degrees to register, which is also about enough to stop a red looking red.
There is no true red that separates from coral: the nearest candidates are all
pinks.

So the accent may now be a money colour's neighbour, and two other things keep
a balance clear instead. Colour never carries the meaning by itself — every
figure has a sign and a word next to it — and the accent never paints an
amount, a balance bar or the chip above a figure. What it does colour is the
buttons, the links, the ticks and the "you" pill, in an ink computed per theme
to read at 4.5:1, plus the "you" series in a chart.

The seeds and the derivation are `src/modules/profile/accent.ts`; the reasoning
above, with the numbers behind it, is at the top of
`src/modules/profile/accent.test.ts`.

There is one red, not two: the colour a delete button uses shares a hue with
the "you owe" red, at its own lightness.

## For the phone app and the API

`GET /api/auth/session` returns `user.accentColor` as a name, and
`PATCH /api/profile` accepts `accentColor` — one of the seven names above, or
`"coral"` to clear it. The dark surface is not on the API: it is a device
setting, and the phone keeps its own.

The phone runs its own copy of the accent arithmetic, because it is given a
name rather than a colour. Two things changed for it here. The money colours
are constants now, so whatever it had for rotating them can go. And the six
variables the web paints are the accent's fill and its ink per theme; those
twenty-eight ink values are spelled out in
`src/modules/profile/accent.test.ts`, which is the table to copy.
