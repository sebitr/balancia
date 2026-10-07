# Add or change an entry in a dialog over the screen on a desktop, with the split laid out on the form and ⌘↵ to save

Branch: `feat/entry-dialog`

Design: https://claude.ai/artifact/Nwc4hfpwGTdcHj4e7suBHQ (boards 14 · Add to which group?, 15 · Add expense, 16 · Record repayment)

From `lg` (1024px) up, the add/edit entry drawer is a dialog in the upper middle
of the window — 720px wide, 880px from `xl` — over the screen it was opened
from. The type tabs sit in its title row, the amount beside the description
from `xl`, the split sheet's contents on the form instead of behind a row, the
category and currency pickers in popovers, Cancel beside the save button, and
⌘↵ (Ctrl ↵) saves from any field. The Repayment tab lays the outstanding
repayments out one line each, the payment methods as chips, and says the
currency the two end up square in. Settle up gets a Record a repayment button
that opens that tab with nobody picked, and "Add to which group?" is a small
dialog answered with 1–9 and the arrows. `Dialog` gains a size, and a bottom
sheet can ask to be a dialog from `lg`. Below `lg` nothing moves. Package 2 of
the desktop experience.
