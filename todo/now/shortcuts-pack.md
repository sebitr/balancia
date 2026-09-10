# Turn the API key and the parser into a shortcut somebody can build in six actions

Branch: `feat/shortcuts-pack`

The two things that made Shortcuts support need Swift both landed in #339 and
#340 — a key a person can paste, and an endpoint that turns a sentence into an
entry. What was left between them was arithmetic: `/api/parse` answered in major
units and every write takes minor ones, so a shortcut had to carry an ISO 4217
table or multiply by a hundred and be wrong about the yen.

So `/api/parse` now also answers `amountMinor`, null wherever the conversion
cannot be made honestly, and `docs/shortcuts.md` is the recipe: which key to
mint, the three calls, the six Shortcuts actions, and five automations worth
building.

`tests/integration/shortcut-recipe.test.ts` runs the recipe rather than
describing it twice — a rename that would break somebody's shortcut fails the
build first.

Deliberately not here: signed `.shortcut` files. Importing an unsigned one is a
fiddly path on modern iOS and signing needs a Mac plus a device to prove the
import on; publishing files nobody has confirmed will open is worse than
publishing none. Said so in the doc rather than left as a gap.
