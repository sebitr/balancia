# Let the iOS app ask for a sign-in code and spend it, and tell it which ways in this instance offers

Branch: `feat/mobile-sign-in-code`

The web's "Email me a sign-in code" reaches the phone: `POST /api/auth/code` is
`requestSignInCodeAction` over JSON, `POST /api/auth/session` takes `{email,
code}` beside `{email, password}`, and `GET /api/auth/options` answers
`{password, code, passkey, apple}` so the app can hide what an instance cannot
do — the same rule the web's page applies at render time. See
`docs/mobile-api.md`, _Signing in with a mailed code_.
