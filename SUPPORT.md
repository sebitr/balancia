# Support

Balancia is a small open-source project. Choosing the right channel makes it
much easier to help.

## Questions and setup help

Start a [GitHub Discussion](https://github.com/sebitr/balancia/discussions) for:

- choosing whether or how to self-host;
- Docker, reverse-proxy or environment questions;
- understanding expected product behavior; and
- ideas that are not yet concrete feature proposals.

Before posting, check the [documentation index](docs/README.md),
[FAQ](docs/faq.md), [self-hosting guide](docs/self-hosting.md) and existing
discussions.

## Bugs

Use the [bug report form](https://github.com/sebitr/balancia/issues/new?template=bug_report.yml)
when Balancia behaves incorrectly and the problem can be reproduced.

Include:

- the release tag or commit SHA;
- installation method and relevant non-secret configuration;
- exact steps and expected behavior;
- currencies and exact values if money is wrong; and
- a short log excerpt after checking that it contains no secrets.

Do not paste `.env`, database URLs, passwords, session cookies, invitation
links, API keys or complete logs.

## Feature requests

Use the [feature request form](https://github.com/sebitr/balancia/issues/new?template=feature_request.yml).
Describe the problem first, who experiences it and what they do today. A clear
use case is more useful than a finished interface proposal.

## Security vulnerabilities

Do not open an issue or Discussion. Follow the private reporting process in
[SECURITY.md](SECURITY.md).

## What maintainers can support

Maintainers can help explain Balancia, reproduce repository defects and improve
the documented installation. They cannot administer a private instance, access
its database, recover lost secrets or guarantee response times for volunteer
support.

For production self-hosting, the operator is responsible for server security,
updates, availability and tested backups.
