# Stop cloud backups deleting each other, undoing a pause, ignoring a new key, and reaching the metadata service

Branch: `fix/backup-retention-and-runs`

Four defects an audit of the encrypted cloud backup found. Two destinations sharing a folder took each other's backups for their own, so retention deleted the other's files and the restore list offered them: names now carry the destination's tag, and an untagged file from before is deleted only when the destination's own run history says it wrote it. A run's end wrote back the status and schedule it had read at its start, so a pause made while it ran was undone. A new recovery key was skipped as "unchanged" for up to a week, and receipts sent under the old key stayed referenced forever. And the metadata-address block was a text-prefix check that an IPv4-mapped IPv6 address walked past. Details in `docs/cloud-backup.md`.
