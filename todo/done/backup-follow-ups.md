# Keep a rotated sign-in token, close a backup a restart cut short, and stream a restore instead of holding it

Merged: 2026-11-24 in #503

Follow-ups to the cloud backup audit. A refresh token the provider rotated while connecting, reconnecting or during a long run was thrown away and the spent one kept. A run cut short by a worker restart showed "running" for two hours, its clock started when it was queued rather than when it began, and a run given up while it waited in the queue could later run anyway and overwrite its own failure. A restore held the whole file in the web process up to three times over, and an error's host and region were blanked as if they were passwords. And a WebDAV or S3 server that redirects elsewhere is followed by rclone, which nothing here can switch off; `docs/cloud-backup.md` now says so beside DNS rebinding.
