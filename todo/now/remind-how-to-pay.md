# Send the way to pay in the same bubble as the amount

Branch: `feat/remind-how-to-pay`

Six QR standards and seven payment deep links were already implemented, chosen
by what is being paid into rather than by preference — a Swiss banking app
reads the QR-bill, a Czech one reads SPAYD. None of it had ever left the
settle-up screen, which is the screen the person who owes you is precisely not
looking at. A reminder is.

`src/modules/reminders/pay-with.ts` asks that catalogue a narrower question
than the settle screen does: what survives being pasted into a chat app. A
link, a one-line code, or the detail itself — and the scannable code as a PNG
attached through `navigator.share`, which is the whole point for the two SEPA
standards, since a Girocode is an image and never was text.

Two rules narrower than the screen's, both already the group link's: it goes
only with a reminder that leaves the app, and nothing names a figure that is
not the debt — so somebody owing in two currencies gets the account and no
amount anywhere.

The full account is in `docs/settling-up.md` under _A reminder carries it too_.
