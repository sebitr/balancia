# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/sebitr/balancia/security/advisories/new).
Do not include vulnerability details in an issue or Discussion.

Please include:

- What the issue is and what an attacker could achieve with it
- Steps to reproduce, or a proof of concept
- The version or commit you tested
- Anything relevant about the configuration (storage driver, reverse proxy, …)

What to expect:

|                                         |                                                                        |
| --------------------------------------- | ---------------------------------------------------------------------- |
| Acknowledgement                         | Within 3 working days                                                  |
| Initial assessment                      | Within 7 days                                                          |
| Fix for a confirmed high-severity issue | As quickly as we can, with a coordinated release                       |
| Credit                                  | Offered in the advisory and release notes, unless you prefer otherwise |

This is a volunteer-maintained project with no bug bounty. We will still take
your report seriously and act on it.

## Supported versions

Security fixes land on the latest release. There are no long-term support
branches; upgrading is the supported path.

## What is in scope

Anything that lets someone:

- Read or modify financial data in a group they are not part of
- Escalate from a guest to a member, or from a member to an owner
- Bypass authentication, or forge a session or an invitation
- Read a receipt they are not authorized to read
- Inject SQL, execute code, or perform stored XSS
- Break the integrity of recorded amounts

## What is out of scope

- **Anything requiring an already-compromised server**, database or admin
  account. If an attacker can read your database, they have your data; that is
  not a separate vulnerability.
- **Denial of service through raw volume.** Balancia is a self-hosted
  application; capacity is the operator's problem.
- **Missing hardening headers with no demonstrated impact.** Tell us anyway,
  but as an issue, not an advisory.
- **Deliberate behaviour**, in particular:
  - **Anyone holding a guest invitation link can act as that participant.**
    That is the feature. The UI states it plainly when the link is created, and
    the link can be revoked and regenerated at any time.
  - Members can edit and delete each other's expenses. Groups are built on
    mutual trust; the append-only activity log is the accountability mechanism.
  - **A guest who owes someone sees how to pay them** — the IBAN or handle and
    the payment code — and a guest can create that debt by recording an
    expense "paid by X, split on me". Guests keep this so that a group whose
    people are not all on the app can still pay each other. What a guest does
    not get is described under _Guest access_ below.
- Reports from automated scanners with no proof of exploitability.

---

## The security model

Understanding these choices makes it easier to spot a genuine deviation.

### Authentication

Implemented in this repository — there is no third-party auth service.

- **Passwords** are hashed with **scrypt** (Node's standard library) at N=2¹⁷,
  r=8, p=1: roughly 128 MB of memory per hash, which is what makes an offline
  attack on a stolen database impractical. The stored format records its own
  parameters so they can be raised later without invalidating existing hashes.
- **Sign-in is constant-time with respect to account existence.** When no
  account matches, a dummy hash is verified anyway, and the error message is
  identical to a wrong password. This is deliberate: the alternative turns the
  login form into an account-enumeration oracle.
- **Sessions** are 256-bit random tokens in `HttpOnly`, `SameSite=Lax` cookies,
  `Secure` whenever the public URL is HTTPS. **Only the SHA-256 hash is
  stored**, so a database leak yields no usable sessions. There is no
  signed-payload cookie whose secret could be stolen to mint arbitrary sessions.
- **An email confirmation link confirms the address wherever it is opened,
  and signs in only the browser that registered.** Registration leaves a
  short-lived `HttpOnly` cookie, sealed under a key derived from
  `AUTH_SECRET` and scoped to `/verify-email`, naming the account; the link
  starts a session only where that cookie names the same account. Anywhere
  else it lands on the sign-in page. A link is only a URL: without this, one
  forwarded unopened to a guest signed the guest's browser into the sender's
  account, and took the guest's seat with it.
- **Passkeys (WebAuthn)** use `@simplewebauthn/server` for the protocol —
  CBOR/COSE parsing and signature verification are not things to hand-roll.
  Balancia owns the state machine around it: challenges are server-issued,
  stored, single-use and expire in five minutes; origin and relying-party ID
  come from validated configuration; the signature counter is checked and a
  counter that fails to advance is refused as a possible cloned authenticator.
  Where the passkey is the only credential — a passkey signup, and any sign-in
  to an account with no password — the authenticator must have verified its
  holder with a PIN, fingerprint or face. Beside a password, a key that only
  proves somebody touched it is still accepted.
- **Recovery takes the account back, not only the password.** A password reset
  ends every session, revokes every API key and spends any email change still
  waiting for its link. Confirming an email change ends every session and
  revokes every API key. A reset leaves the account's passkeys and its Apple
  link in place: they are the owner's own in the ordinary case, and each can be
  removed from Settings → Security. Changing a password while signed in ends
  every other session and nothing else.
- **The first proof of an address removes everything from before it.** A
  passkey signup takes its address on trust, so an account can exist, with
  credentials, before anybody has shown they read its inbox. The first reset
  link, sign-in code or confirmation link that proves the address removes every
  passkey, Apple link, API key, pending email change and session the account
  held until then; a sign-in code also drops a password set before the proof.
  Whoever proves the inbox starts with only what the proof handed them.

### Guest access

- Invitation tokens carry **256 bits** of CSPRNG entropy.
- **Only a SHA-256 hash is stored.** The raw token is shown once and never
  again — not in the database, not in logs, not in activity metadata.
- Redemption exchanges the invitation for a **separate** guest session token and
  immediately **303-redirects to a URL without the token**, so it never lands in
  browser history, referrer headers or proxy logs.
- Redemption is rate limited per IP.
- A guest session is pinned to **one participant in one group**. Passing a
  different group ID cannot widen it; it fails.
- Guests can do everything financial and nothing administrative: no managing
  people, links, settings, ownership or deletion, and no import.
- A guest is sent **no email address and no account id** for anybody in the
  group — not the owner's sign-in address, not one typed for a person without
  an account — on the web or over the API. They learn whether each person has
  an account, and nothing that identifies it.

### Payout details

How somebody wants to be paid back belongs to their account, not to a group.

- It is read only by people the group's balances say owe them money, guests
  included — see _What is out of scope_ above. There is no way to ask for a
  named person's details.
- What such a reader gets is the detail to pay into and its payment code. A
  postal address is never sent as a field; the Swiss QR-bill carries the
  creditor's address inside its payload, because the standard requires it.
- **API keys read none of it**, at any scope. The settle-up route answers a key
  with the transfers and an empty list of payout hints.
- A PayPal detail must be a `paypal.me` or `paypal.com` link, and only such a
  link is ever drawn as the "Open PayPal" button.
- Revoking a link, regenerating it, or removing the participant kills every
  session derived from it immediately.
- **Claiming a seat with an account retires its links**, however the claim
  happens — from the guest's own browser, from the app with the personal
  link, or by picking the name from the group-wide link. A seat with an
  account on it never opens as a guest again: redemption and every session
  check refuse it, whatever the link row says.
- **A group started without an account belongs to its creator's seat.** It
  has no owner until somebody claims a seat, and only a claim of the seat it
  was started from makes an owner; anybody else joins as a member. The
  group-wide link does not offer that seat to anybody while the group has no
  owner.
- **Closing an account does not delete a group a guest is still using.** A
  participant holding a live link counts as somebody left in the group, so
  the group is kept, with no owner, rather than deleted with its expenses.

### Authorization

Every group-scoped read and mutation goes through one function,
`authorizeGroup`. Two rules make insecure direct object references hard to
write:

1. **Authorization runs before the record is fetched**, never after.
2. **Repository queries are scoped by the verified group ID**, so an ID from
   another group resolves to nothing rather than to someone else's data.

"Not a member" and "does not exist" both produce a 404. Membership is not
something an outsider should be able to probe for.

A refusal given to a member — an owner-only action, an archived group, a
person removed from it — says what it is instead, on the mobile API with its
own status and `code`. It is only reachable once the membership check has
passed, so it tells nobody anything they could not already read.

A group page and the layout around it both authorize, and within one server
render the second is answered from the first rather than with another query.
Nothing remembered outlives that render: the one that follows a Server Action
— removing someone, say — asks afresh, and Server Actions and API routes
themselves ask on every call. `authorizeGroup` itself remembers nothing.

### Uploads

- MIME type is determined by **sniffing the file's magic bytes**, never the
  filename or the client's `Content-Type`.
- Only JPEG, PNG, WebP, GIF, HEIC and PDF are accepted. **SVG is refused on
  purpose** — it is a script-capable XML document.
- Object keys are **server-generated random hex**; nothing user-controlled
  reaches a filesystem or bucket path, and the storage driver additionally
  refuses any key that escapes its root.
- Downloads are authorized per request and served with
  `Content-Disposition: attachment`, `X-Content-Type-Options: nosniff`, a
  `default-src 'none'; sandbox` CSP and `Cache-Control: private, no-store`.
- There is no publicly served uploads directory.
- **Photographs lose their metadata before they leave the device.** JPEG, WebP
  and HEIC receipts are redrawn in the browser — orientation applied, long
  edge capped at 2560 px — so the EXIF block, and the GPS position a phone
  writes into it, never reaches the server or the other members of the group.
  PNG, GIF and PDF are sent as they are. A browser that cannot decode the
  format (HEIC outside Safari) sends the original, and so does a client of the
  API that uploads directly: the server stores what it is given.
- The size limit is enforced on the bytes that arrive, not the declared
  `Content-Length`, so a chunked upload is held to it too. One group keeps at
  most 2 GiB of receipts in 5,000 files, whoever uploads them — guest links
  included.
- A receipt's file is removed when its row is: on deletion, when the worker
  sweeps uploads never attached to an expense, and when its group is deleted,
  directly or with the last account that could open it. When the storage
  refuses one receipt's delete, the row is kept and the next sweep tries
  again; when it refuses a deleted group's, the count is logged.
- Exporting a group's whole history is rate limited per person and group.

### Transport and headers

- Strict CSP with a per-request nonce; no `unsafe-inline` scripts in production.
- `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`,
  `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
  `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and HSTS in
  production.
- Cross-origin state-changing requests are rejected by origin check, on top of
  Next.js's own Server Action origin validation and `SameSite` cookies.

### Money integrity

Not conventionally "security", but it is what the application is for:

- Amounts are integer minor units in `bigint`. No float ever touches money.
- Allocations are checked to sum exactly to the total; a mismatch is refused.
- The balance engine asserts that all balances sum to zero and **refuses to
  display figures** if that is ever violated.
- Financial writes and their activity events commit in the same transaction.
- Exchange rates are frozen per expense; history is never silently
  recalculated.

### Privacy

- No telemetry, no analytics, no error reporting, no update check. Balancia
  contacts no external service at runtime.
- Imported files are parsed in-process and never sent anywhere.
- Logs redact secrets, tokens, passwords and connection strings by key,
  wherever they sit in a logged object.
- A failed database statement is logged with its error class, SQLSTATE,
  statement text and stack frames, and never with the values bound to it:
  Drizzle's parameter list, PostgreSQL's `detail`, and any database message
  that can quote a value are dropped before the line is written. That holds for
  errors the application logs and for those Next.js prints itself after one
  escapes a page. It does not reach a value the code writes into a log message
  of its own; a rule test refuses the commonest way of doing that, logging an
  error's `.message` or `.stack` in place of the error.
- Activity metadata is validated against a deny-list of secret-ish keys and
  refuses to store anything that looks like a token.

---

## What operators should do

- **Serve over HTTPS.** Passkeys will not work otherwise, and Balancia refuses
  to start with a non-localhost HTTP `APP_URL`.
- **Make sure your proxy sets `X-Forwarded-For`.** Without it, rate limiting
  sees every request as one client.
- **Keep the published ports on `127.0.0.1`**, which is what `compose.yaml`
  does unless told otherwise. A client that reaches the app's port directly
  skips the proxy and writes its own `X-Forwarded-For`; a database on the
  network has only its password in front of it.
- **Back up `.env`** along with the database and receipts. It holds the only
  copy of `AUTH_SECRET` and `POSTGRES_PASSWORD`.
- **Keep `ALLOW_REGISTRATION=false`** on a private instance.
- **Do not raise `AUTH_RATE_LIMIT_MAX`** on a public deployment.
- **Update regularly**; run `pnpm audit:prod` if you build your own images.
- **Check where a pulled image came from.** Published images are attested by
  the GitHub Actions workflow that built them, after CI passed on the same
  commit:
  `gh attestation verify oci://docker.io/sebitro/balancia:<tag> -R sebitr/balancia`.
