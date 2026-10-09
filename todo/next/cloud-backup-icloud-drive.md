# Back up to iCloud Drive, with a sign-in that asks for Apple's code and a monthly "sign in again"

See: `docs/cloud-backup.md` ("Not offered: iCloud Drive")

The rclone mapping and the credential shape exist and no screen offers them, because signing in is an interactive two-factor handshake that nothing in the repository can test without an Apple account. The work is a two-step form (password, then the code Apple sends) driving rclone's `config create --non-interactive` state machine, a "sign in again" path through the reconnect flow for the thirty-day trust token, and watching whether it really lasts. Advanced Data Protection must be off, which the form has to say.
