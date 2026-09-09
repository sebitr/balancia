# Give the dictate button its own ways to close the microphone instead of one that belongs to the engine, and take the button away when the shortcut cannot work

Branch: `fix/voice-stop-and-availability`

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
