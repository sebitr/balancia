# Connect Google Drive, Dropbox and OneDrive through an app of your own, not only the server's

Branch: `feat/backup-own-oauth-app`

Cloud backup shipped with one client ID and secret per provider, set by the server's operator. On a server whose operator registered nothing, the three account providers were switched off; on one that did, every owner's backups shared a single app's quota, review status and secret. Each owner can now register an app in their own provider account and paste its client ID and secret into the wizard, and it is sealed with their connection and used for every refresh. The server-wide app stays as an optional single button.

A provider refusing the app is its own failure (`app`), not a revoked connection: it is not retried, and Reconnect goes back through the wizard for new details.

How it works and what each provider asks for: `docs/cloud-backup.md#use-your-own-app`. The form was not drawn in Claude Design; `docs/design/cloud-backup.md` says so.
