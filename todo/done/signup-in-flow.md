# Sign up with a password without leaving the sign-up steps, and say on the welcome what the app is for

Merged: 2026-10-06 in #442

Design: https://claude.ai/artifact/7krRtbYdVV5EaP4ozJSSND

On an instance with no mail server, "Sign up with a password" used to open
`/register/password`, a separate page with its own header and a confirm field.
It now opens the password inside the Account step — email and one password
field with an eye to show it — and the reader carries on through the same
steps as a passkey. The welcome's headline says what the app does, and the
group import page names every status of a past import in words.
