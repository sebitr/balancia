# Let the dictate button be pressed a second time, and read the francs a Swiss recogniser actually writes

Branch: `fix/dictate-second-press`

Two things reported from using the feature: dictate worked once per page load
and then the form went dead, and "restaurant 50 francs" saved a description of
"restaurant fr.".

## The form went dead, and the scrim did it

Answering the consent dialog left its own overlay behind. Radix keeps an
overlay mounted while the exit animation plays and unmounts it when the
animation ends; nested inside the open add-expense sheet, that unmount never
happened. The node stayed with `data-state="closed"`, still `fixed inset-0`.

The half that made it fatal rather than untidy: while the body is locked to
`pointer-events: none`, each Radix layer re-enables itself with an **inline**
`pointer-events: auto` — and an inline style outranks any class. So an
abandoned full-screen scrim went on swallowing every click, and no ordinary
utility could take it back. `document.elementFromPoint` over the dictate
button returned the overlay, not the button.

At ten percent black over a sheet that is already dimmed it is invisible, so
what the reader got was not a covered screen but a dead one — and not just
dictate: the whole form. A reload was the only way out.

So a closed overlay is inert, `data-closed:pointer-events-none!`, in all three
components that share the pattern — alert dialog, dialog and sheet. The `!` is
the entire fix; without it the class loses to the inline style every time.
Worth having even where the unmount works, since for the length of the fade
the scrim used to swallow the click that came after it.

## "fr." is how Switzerland writes francs

Ask a Swiss recogniser for "restaurant 50 francs" and it gives back
"restaurant 50 fr.", the way a till receipt does. The dot is folded off before
any rule is matched and "fr" is two letters short of an ISO code, so the
abbreviation fell through everything: it stayed in the description and the
figure kept the group's own currency. `fr`, `frs` and `sfr` now read as CHF.

## Verified in the browser

Driven with real clicks rather than synthetic ones, which matters here —
`element.click()` bypasses `pointer-events` and would have shown a green pass
against a screen nobody could actually use. Before: the overlay on top of the
button and one session only. After: three sessions, the dialog reopening
correctly on the press that follows "listen this once", and the overlay
computing `pointer-events: none` while its inline `auto` is still on it.
