# Let the administrator allow backups to the local network from Administration, instead of editing the environment file

See: `docs/design/cloud-backup.md` (§5.12, boards J1 and J2, question 3)

Today `BACKUP_ALLOW_PRIVATE_ENDPOINTS` is an environment variable and the Administration screen states its value. The design also draws a switch. That needs a stored setting beside the telemetry ones in `instance_settings`, locked when the environment forces a value, and a decision about whether turning it on should ask first, since it lets any account make the server open connections to internal addresses.
