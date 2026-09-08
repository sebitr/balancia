# Let the dictate button reach the microphone the app had disabled for itself, listen in a tag a recogniser knows, and say so when it is refused instead of going quiet

Branch: `fix/voice-dictation`

"Dicter" opened, pulsed, stopped, and left the form exactly as it was. Three
things stacked up behind that, and the third is why the first two went unseen
for a release.

`Permissions-Policy` named the camera and not the microphone. The receipt
scanner had asked for `camera=(self)` when it needed it; the voice button
never asked, so the header shipped `microphone=()` — which is not "do not
prompt yet", it is the microphone switched off for the document. The reader
was never asked, and the recogniser was refused before it began.

`recognition.lang` was the app's bare locale, `en` or `fr`. A recogniser wants
a region on it and answers a tag it does not know with
`language-not-supported`. The reader's own tag is the better guess whenever it
is the same language — a French speaker in Geneva is `fr-CH` and the app
cannot know that — so it wins, with a region map behind it.

And every one of those failures was swallowed: `onerror` set `listening` to
false and said nothing, on the reasoning that a reader looking at a form they
can still type into does not need to be told. That is right for hearing
nothing, and wrong for being refused — a button that goes quiet cannot tell
the two apart, and neither could anybody debugging it. `no-speech` and
`aborted` stay silent; the rest is a refusal, and refusals speak.

The parser and the form were never at fault: fed a transcript directly, "24
francs Coop" fills the amount and the description correctly.
