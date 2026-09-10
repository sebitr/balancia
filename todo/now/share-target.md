# Share target: register for images, PDFs and text, so a receipt shared from another app lands in the drawer — the other half of `briefs/entry-friction.md` idea 6, left out of the Add Entry rework because it is manifest and route work rather than drawer work

Branch: `feat/share-target`

It stayed drawer-free, as predicted. The screen writes the group's **draft** —
the same shape the drawer already restores from `#draft=1` — and navigates
there, so there is still one place the entry form is constructed.

The POST is the whole reason there is a service worker in it. A share target
that accepts files must be `method: POST, multipart/form-data`, a POST cannot be
a page you can reload, and a `File` cannot travel in a query string. So the
worker takes the form, stashes it in IndexedDB and answers 303 to `/share`,
which is an ordinary GET screen.

Text is parsed by `heardEntry` on the device — the same parser the dictate
button uses, which #339 had already established has nothing to do with
microphones. No round trip, and it works with no signal.

Two things worth knowing next time:

- **Not iOS.** Safari implements no Web Share Target, for installed web apps or
  otherwise. This is Android and desktop Chromium; the native app's share
  extension is the other half and is not in this repo.
- **A bare URL is never read as a sentence.** `…/product/12345` parses as a
  hundred and twenty-three francs nobody spent. `sharedText` drops it and the
  drawer opens empty, which is the honest outcome.
