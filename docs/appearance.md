# Appearance

How Balancia looks is four decisions, kept in three places. This page says
which is which, and why the colours that mean money never move with any of
them.

## The four decisions

| Decision     | Choices                                              | Kept                                   |
| ------------ | ---------------------------------------------------- | -------------------------------------- |
| **Theme**    | Auto (follow the system), Light, Dark                | In the browser (`localStorage`)        |
| **Surfaces** | Light: Cream or Paper · Dark: Plum or Midnight       | Cookies on this device                 |
| **Contrast** | Auto (follow the system), Standard, Increased        | Cookie on this device                  |
| **Accent**   | Coral, Amber, Mint, Ocean, Lavender, Raspberry, Plum | Cookie, and the account when signed in |

The theme is applied by a script that runs before the first paint, so a dark
page never flashes light. The surfaces, the contrast and the accent are read
by the server and written onto `<html>` in its own HTML — attributes for the
first three, inline variables for the accent — for the same reason: a page
that changes colour under the reader once per visit is worse than one that
takes a moment to follow them to a new device.

Surfaces and contrast belong to the device rather than the account, the way
the theme does: the phone that wants Midnight for its OLED panel is not the
laptop that wants Paper by a window, and "increase contrast" is a system
setting on both. The accent is a taste, so it follows the account — sign in on
a new device and it is there.

## Surfaces

**Cream** is the palette as drawn: warm paper, white cards, deep plum ink.
**Paper** is the same with the warmth taken out — pure white, cooler greys.
**Plum** is the dark theme as drawn. **Midnight** takes it down to where an
OLED panel goes black.

Each is a short block of overrides at the bottom of `src/app/globals.css`,
applied when `<html>` carries `data-light="paper"` or
`data-dark="midnight"`. The defaults carry no attribute, so a document nobody
painted is the cream-and-plum one.

## Contrast

**Increased** darkens captions, strengthens borders and takes every balance
figure and link from 4.5:1 to 7:1 against the page. **Auto** applies it
whenever the system asks for more contrast (`prefers-contrast: more`), and
follows a change to that setting while the page is open. A reader who chooses
Standard or Increased is left alone.

## The accent, and the money colours

Green means somebody owes you, red means you owe, amber marks who paid. Those
three are the only colours in the app that carry meaning, and for a long time
the accent could land on one of them: coral sat two degrees from the "you owe"
red, mint was the "gets back" green exactly.

Now the accent is a seed, and the money colours keep their distance from it:
any of the three that sits within forty degrees of the accent's hue is rotated
away until it is forty degrees clear, inside the band where it still reads as
itself. So a coral user sees a ruby "you owe", a mint user a grass-green "gets
back", an amber user an olive payer, and the other four accents leave all
three where they are. (Material You does the reverse — it shifts reserved
colours a few degrees _toward_ the accent so they feel like one palette. Here
the meaning matters more than the harmony.)

The accent also colours the links, the ticks and the "you" pill, in an ink
computed per theme to read at 4.5:1, and the "you" series in a chart. It never
colours an amount, a balance bar or the chip above a figure. The preview at
the top of the appearance screen shows all of this happening as the swatches
are tapped.

The arithmetic is `src/modules/profile/money-tones.ts`; the seven results are
spelled out in `src/modules/profile/accent.test.ts`.

## For the phone app and the API

`GET /api/auth/session` returns `user.accentColor` as a name, and
`PATCH /api/profile` accepts `accentColor` — one of the seven names above, or
`"coral"` to clear it. Surfaces and contrast are not on the API: they are
device settings, and the phone keeps its own.
