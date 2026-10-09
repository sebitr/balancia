# Bring receipts back from a cloud backup in the browser, as one download, instead of decrypting each file by hand

See: `docs/cloud-backup.md` ("What is in a backup")

Receipts are backed up as one encrypted object each, listed inside the data backup, and restoring them is a manual step today: decrypt every `receipt-<id>.age` with the `age` command. The restore screen could fetch and decrypt them in the browser and offer a single archive named after each receipt's original file name, and the import could attach them to the entries it restores.
