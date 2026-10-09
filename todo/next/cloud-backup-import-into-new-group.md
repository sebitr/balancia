# Take a group out of an opened cloud backup straight into a new group, without downloading the file and uploading it again

See: `docs/design/cloud-backup.md` (§5.10, question 1)

Restore opens a backup in the browser and offers Download as JSON, then asks the person to create a group and use Import in its settings. The design draws an "Import into a new group" button. It needs a create-group step and a way to hand the decrypted JSON to the import screen without a second upload, and `docs/data-migration.md` says the import never creates a group, so that rule changes too.
