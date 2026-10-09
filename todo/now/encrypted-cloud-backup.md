# Back up the groups you own to your own cloud, encrypted so that only you can read them

Branch: `feat/encrypted-cloud-backup`

Design: https://claude.ai/artifact/A5JMYtHhvcwGNnWUs3Ycpq (Claude Design, boards A to K), written up in `docs/design/cloud-backup.md`; how it works is `docs/cloud-backup.md`.

A group owner chooses where (Google Drive, Dropbox, OneDrive, any S3-compatible store or WebDAV server, Infomaniak, and — marked experimental — Proton Drive) and how often. Each run is encrypted in the worker to a recovery key that only the owner holds, so neither this server nor the cloud can read it afterwards. Receipts are an opt-in second step, with a disclaimer.

Built on the `age` format (`age-encryption`) and on `rclone` for the transport, rather than a client per provider. The follow-ups it leaves are in `todo/next/cloud-backup-*.md`.
