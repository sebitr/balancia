# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/your-org/balancia/security/advisories/new),
or by email to `security@example.com`.

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
- **Passkeys (WebAuthn)** use `@simplewebauthn/server` for the protocol —
  CBOR/COSE parsing and signature verification are not things to hand-roll.
  Balancia owns the state machine around it: challenges are server-issued,
  stored, single-use and expire in five minutes; origin and relying-party ID
  come from validated configuration; the signature counter is checked and a
  counter that fails to advance is refused as a possible cloned authenticator.

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
- Revoking a link, regenerating it, or removing the participant kills every
  session derived from it immediately.

### Authorization

Every group-scoped read and mutation goes through one function,
`authorizeGroup`. Two rules make insecure direct object references hard to
write:

1. **Authorization runs before the record is fetched**, never after.
2. **Repository queries are scoped by the verified group ID**, so an ID from
   another group resolves to nothing rather than to someone else's data.

"Not a member" and "does not exist" both produce a 404. Membership is not
something an outsider should be able to probe for.

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
- Uploads never attached to an expense are swept by the worker.

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
- Logs redact secrets, tokens, passwords and connection strings.
- Activity metadata is validated against a deny-list of secret-ish keys and
  refuses to store anything that looks like a token.

---

## What operators should do

- **Serve over HTTPS.** Passkeys will not work otherwise, and Balancia refuses
  to start with a non-localhost HTTP `APP_URL`.
- **Make sure your proxy sets `X-Forwarded-For`.** Without it, rate limiting
  sees every request as one client.
- **Back up `.env`** along with the database and receipts. It holds the only
  copy of `AUTH_SECRET` and `POSTGRES_PASSWORD`.
- **Keep `ALLOW_REGISTRATION=false`** on a private instance.
- **Do not raise `AUTH_RATE_LIMIT_MAX`** on a public deployment.
- **Update regularly**; run `pnpm audit:prod` if you build your own images.
