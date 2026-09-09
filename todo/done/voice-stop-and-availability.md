# Give the dictate button its own ways to close the microphone instead of one that belongs to the engine, and take the button away when the shortcut cannot work

Merged: 2026-09-09 in #330

#325 got the microphone reaching the recogniser. It did not get it closing
again: the button sat on "J'écoute…" with the microphone live, and pressing it
a second time was the only way out.

`continuous = false` asks the engine for a single utterance and leaves the
engine to decide when that utterance ended. Where its endpointer does not
decide — a noisy room, a headset holding the stream open — nothing else here
ever closed the session, because `onend` was the only thing that cleared
`listening` and released the recogniser, and `onend` is the engine's to fire.
There was exactly one way out and it was not ours.

Now there are four. `onresult` stops as soon as it has the transcript rather
than waiting to be told; `onspeechend` stops too, which is what MDN's own
example does; a fifteen-second ceiling aborts whatever the engine is doing,
which is the only path that trusts nothing; and a `start()` that throws — it
does, on an already-started recogniser — puts the button back rather than
leaving it showing a session that never began.

The button also goes away when the shortcut cannot work. It already did that
for a browser with no recogniser. It now does it offline as well, because
Chrome's recogniser is a web service rather than something on the device:
"your audio is sent to a web service for recognition processing, so it won't
work offline". Offline it was a control that opened the microphone, listened
to a whole sentence and failed. Availability is external state subscribed to
`online`/`offline`, so the button comes back with the network — and a session
still running when the network drops is closed with it, since a button that
has gone is one nobody can press to stop.

`voice-button.test.tsx` holds all of it, one test per way out, because the bug
was never that a single path was wrong. It was that there was only one.

Worth a look while nearby: the receipt scanner is explicitly on-device and
says so, and this ships the reader's voice to Google without mentioning it.
`processLocally` is the opt-in. That is a separate item, not this branch.

## Asking before the voice leaves the device

The note above about `processLocally` turned out to belong here after all,
because it is the same question as availability: what the button does depends
on where the words go.

Engines that can transcribe on the device are asked first, per language, and
where they say "available" the recognition is pinned local with
`processLocally` and nothing is asked — there is no risk to describe, and
interrupting that reader would be a worse feature than never asking. Anything
short of a plain "available" counts as no: a model that is merely
_downloadable_ has not been downloaded, so the words would still travel today.

Everything else asks once, in an alert dialog with the three answers: listen
this once, listen and stop asking, don't listen. The remembered answer is a
`localStorage` key rather than an account setting, because what it consents to
is _this_ browser handing audio to _its_ vendor — a phone and a laptop are two
different promises, and the reader's account has nothing to do with it.

The footer is stacked at every width, unlike every other two-button dialog in
the app: three of these overflow a `max-w-sm` content box, which is exactly
what the first build did.

Measured on this machine, for what it is worth: `available()` reports
`unavailable` for `en-US`, `fr-FR` and `fr-CH`, and `available` for the cloud
path. The question is not hypothetical here.
