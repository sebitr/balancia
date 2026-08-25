# Licensing Balancia

Balancia is licensed under the
[GNU Affero General Public License, version 3 or later](../LICENSE). The AGPL
lets anyone use, inspect, modify and redistribute the software while protecting
the source rights of people who use a modified version over a network.

This page is a practical summary, not legal advice. The licence text is the
authority.

## Common scenarios

| What you do                                                          | What the licence requires                                                                           |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Run Balancia unmodified for yourself, a household or an organization | No source-sharing step beyond keeping the existing notices.                                         |
| Modify it and use it privately with no other network users           | Private changes can stay private.                                                                   |
| Modify it and let other people use it over a network                 | Offer those users the complete corresponding source of the running version under AGPL-3.0-or-later. |
| Distribute Balancia, modified or unmodified                          | Provide the source, licence and notices required by the GPL terms incorporated into the AGPL.       |

For a network service, a prominent **Source code** link inside the running
application is the usual way to make the offer easy to find. It should point to
the exact source corresponding to the deployed version, including local
modifications and the material needed to build it.

## Why AGPL instead of a permissive licence?

Ordinary permissive licences and the plain GPL do not require an operator to
publish changes merely because people use the software over a network. Shared
expense software holds financial history on behalf of its users. The AGPL keeps
those users entitled to inspect the version they are being asked to trust.

## Production dependency policy

Balancia keeps its production dependency set intentionally auditable:

- a dependency must use a licence compatible with AGPL-3.0-or-later;
- a core runtime path may not depend on a paid tier, licence key, usage quota or
  commercial gate;
- third-party services are optional and off until an operator configures them;
  and
- sensitive financial behavior is tested in this repository rather than hidden
  behind a vendor API.

Reproduce the dependency licence inventory with:

```bash
pnpm licenses list --prod
```

Most production packages use permissive MIT, Apache-2.0, ISC or BSD licences.
The notable copyleft binary is libvips, loaded through `sharp` for image
processing under LGPL-3.0-or-later. It remains a separate, replaceable dynamic
library, which is the relationship the LGPL permits.

QR encoding is delegated to `uqr` (MIT, no transitive dependencies), which is
a TypeScript port of Project Nayuki's reference QR generator — both copyright
lines are in its licence. Reed–Solomon coding and mask selection are a solved,
well-specified problem where a bug is silent: a code that encodes wrongly still
looks like a code. What Balancia keeps is the part that is actually its own,
which is the payment payloads inside the symbol.

Authentication is first-party except for the low-level WebAuthn protocol
implementation in `@simplewebauthn/server` (MIT). Balancia delegates CBOR/COSE
parsing and signature verification because duplicating security protocol code
would add risk, not independence.

## Adding a dependency

Before a pull request adds or upgrades a production dependency:

1. check the direct and transitive licences;
2. confirm that no required feature is gated by a vendor plan or external
   service;
3. explain why the dependency is preferable to the platform or existing code;
4. run `pnpm licenses list --prod`; and
5. describe the result in the pull request.

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the rest of the verification
requirements.
