# Get the Playwright journeys back to green: the headless browser was killing the tab, and one assertion could never pass

Merged: 2026-09-09 in #342

Twelve specs were red on `main` — every test that renders the add-entry form or
its drawer, and no other test in those four files:

```
expenses.spec.ts   32, 56, 78, 103, 121, 151, 223
guest.spec.ts      16, 166
motion.spec.ts     98, 130
responsive.spec.ts 35
```

Two unrelated faults, which is why the list looked like one feature's doing and
was not.

## Eleven of them: the headless shell kills the renderer

They failed as `Target crashed`, which is not a selector that drifted — the
renderer process was dying. Nothing was logged, no `pageerror` arrived, and a
`try`/`catch` around the call catches nothing, because the kill comes from the
browser process and not from JS. `DEBUG=pw:browser` is what says so:

```
Terminating render process for bad Mojo message: Received bad user message:
No binder found for interface media.mojom.OnDeviceSpeechRecognition
Terminating renderer for bad IPC message, reason 123
```

`VoiceButton` probes `SpeechRecognition.available({ processLocally: true })`
from an effect on mount, to know whether dictation can stay on the device and
the consent question can be skipped — `voice-consent.ts` says why that question
exists. The probe is correct. What answered it was not a browser: Playwright
runs headless from `chromium_headless_shell`, a stripped binary with no speech
service behind it, which advertises the API anyway — `available` is a function
there and `SpeechRecognitionPhrase` exists — so nothing the page can read tells
it apart from an engine that means it. Neither
`--disable-features=OnDeviceWebSpeech` nor the `--disable-blink-features` spelling
takes it away, and a flag that silently matches nothing is the wrong lever even
when it works.

The full Chromium answers the same probe with "downloadable" and carries on, so
`channel: "chromium"` in `playwright.config.ts` is the whole fix: the real
browser, in the new headless mode. No app change, and no spec needed touching —
the binary under test is now the engine people actually run.

## The twelfth: an assertion that was never capable of passing

`expenses.spec.ts:223` waited for `getByRole("region", { name: "Total balance" })`
on a group overview. "Total balance" is `positionEyebrow`, the eyebrow on the
dashboard's `PositionWidget`, and it has never been on a group page — the group's
own region is named by the `sr-only` "Your position" heading that `PositionHero`
and `PositionCard` are labelled by. It went in with #323, which replaced a
genuinely flaky "since your last visit" assertion with this one, and it has
failed on every run since. The intent was right and is kept: that region exists
only once the group has something in it, which is what proves the group behind
the drawer re-rendered with the new entry.

## What this says about the red streak

`Playwright journeys` was last green at `009921c9`. It went red at #323 on the
assertion above, and #330 added the eleven on top — so the job has been failing
for nineteen consecutive runs, through #341.

It was not #339, which is where it was noticed: #339 only added `POST /api/parse`
and touched nothing the form renders. A check that stays red for nineteen merges
stops being read, and both of these hid behind the other for exactly that reason.
Worth a conversation about whether a red `main` should block the next merge.

## Still open, and deliberately not done here

The same probe would take a real tab down in any Chromium build without the
speech service — not Chrome, which binds the interface. What such a reader loses
is the tab, on the app's main screen, for having opened it rather than for
pressing dictate. Moving the probe to the first press would shrink that to the
people who actually dictate, at the cost of a probe every one of them waits for.
That is its own change, on its own branch, and it wants a decision about which
browsers are in scope before anybody writes it.
