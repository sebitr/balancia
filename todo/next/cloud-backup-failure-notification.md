# Tell an owner their cloud backup has stopped, in the notifications list and by push, not only on the backup screen

See: `docs/design/cloud-backup.md` (§5.9, question 2)

A failed backup shows as a banner on the backup screen and a "Needs attention" pill on the settings row, which an owner who never opens settings never sees. The design draws one row in the notifications list for it. Every notification carries a group today (`groupId`, `groupName`, a category switch), and a backup failure belongs to the account, so it needs a nullable group or an account-level kind, a renderer, and a cadence: the first failure, then the third in a row, then silence until it recovers.
