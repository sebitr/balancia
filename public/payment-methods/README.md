# Payment method logos

Drop an SVG in here named after the method's code — `twint.svg`, `bizum.svg` —
and the settle-up screen uses it instead of the generated lettermark tile.
Nothing else is needed: the file is picked up on the next page load, with no
rebuild and no restart.

Anything you do not supply keeps its lettermark, so a directory with one file
in it is a perfectly good state.

## Why this is empty

Balancia ships no payment-provider artwork, on purpose.

The marks belong to their owners, and a trademark licence essentially never
permits redistribution or modification by third parties. This project is
AGPL-3.0: everything committed here is redistributed by every fork, and every
recipient gets the right to modify and redistribute it further. Those two
things cannot both be true of the same file.

Your own instance is a different question from this repository. An operator who
has the right to display a provider's mark — because they are that provider,
because they have written permission, or because their jurisdiction's rules on
referential use cover it — can put it here, and it stays on their server.

That decision is yours to make. It is not one the project can make on your
behalf by putting the file in the repository.

## Naming

Lowercase, the method's own code, `.svg`:

`alipay.svg` · `apple_pay.svg` · `bancomat_pay.svg` · `bizum.svg` ·
`blik.svg` · `cash_app.svg` · `crypto.svg` · `google_pay.svg` ·
`interac.svg` · `lydia.svg` · `mbway.svg` · `mobilepay.svg` · `monzo.svg` ·
`n26.svg` · `payconiq.svg` · `payid.svg` · `paypal.svg` · `pix.svg` ·
`revolut.svg` · `satispay.svg` · `swish.svg` · `tikkie.svg` · `twint.svg` ·
`upi.svg` · `venmo.svg` · `vipps.svg` · `wechat_pay.svg` · `wero.svg` ·
`wise.svg` · `zelle.svg`

The codes are defined in `src/modules/settlements/payment-methods.ts`.

Cash, bank transfer and cheque are drawn glyphs rather than brands, and have no
logo to supply.

## What the artwork should be

- **Square-ish.** It is rendered into a 22px tile in the row and 30px in the
  picker, and is letterboxed to fit. A wide wordmark becomes unreadable at that
  size; use the icon mark where a provider publishes one.
- **Self-contained.** No external references, no embedded raster unless the
  provider only publishes one.
- **Legible on a dark plum background.** Marks with their own coloured tile work
  best. A dark monochrome mark disappears — supply the light variant.
