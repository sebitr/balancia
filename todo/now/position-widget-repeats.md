# Stop the home-screen position saying itself three times: one figure per currency, nothing repeated under it, and the reason a tap away instead of a footnote

Branch: `fix/position-widget-repeats`

The first item of a UX pass against the 2026 field. On an account holding
balances in several currencies with no rate to combine them, the widget showed
the signed figure per currency, then a sentence apologising for the missing
rate, then an "Owed to you / You owe" grid that repeated every figure beside a
zero. Nine numbers for three facts. The grid now follows only a single
converted total, which is the one figure it can decompose into something it
did not already say; the sentence lives behind the figures, the way the
conversion disclosure already does; and each figure carries its direction in
words for a screen reader, which the grid's column labels used to do.
