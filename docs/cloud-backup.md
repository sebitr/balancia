# Cloud backup

The owner of a group can back it up to a cloud storage account of their own, on a
schedule, **encrypted so that only they can read it**. Not this server, not the
person who runs it, and not the cloud provider.

This page is the whole story: what it does, how it is built, what it does and
does not protect against, how an owner connects Google Drive, Dropbox or OneDrive
through an app of their own, and — for whoever runs the instance — how to give
everyone a single button instead. The settings themselves are in
[environment.md](environment.md#encrypted-cloud-backup-optional).

It is a different thing from [backing up the server](backup-and-restore.md),
which an operator does for the whole installation with `scripts/backup.sh`. This
one is for the person who owns groups on somebody else's server, or on their own,
and wants a copy in a place the server cannot lose.

## What a person sees

**Settings → Data → Cloud backup.** A short wizard, then a card.

1. **A recovery key** is made in their browser and shown once. It looks like
   `AGE-SECRET-KEY-1…`. They save it somewhere safe (a password manager, a
   printout) and retype its last six characters to prove they did. Only the
   _public_ half is sent to the server. Someone who would rather not trust a key
   made by JavaScript this server serves can make one with `age-keygen` and paste
   only its public `age1…` line (_Use a key I already have_).
2. **Where to back up.** Google Drive, Dropbox or OneDrive are connected through
   the provider's own sign-in page, with an _app_ (a client ID and secret) that
   is the owner's own, or, if whoever runs the server registered one for
   everybody, a single button ([below](#use-your-own-app)). A bucket (any
   S3-compatible service), a WebDAV server (Nextcloud, ownCloud, Infomaniak
   kDrive) or Proton Drive is connected by typing its details, and a **Test
   connection** button proves it can write before anything is kept. A provider
   this server has not enabled (Proton Drive, by default) is shown and says so
   ("Ask your administrator").
3. **What and how often.** Which of the groups they own (all, to start), daily or
   weekly, and how many backups to keep (ten). **Receipts** are a separate,
   quieter choice, off by default, with the cost stated beside the switch and a
   live estimate ("About 38 MB of receipts across 3 groups") once it is on.
4. A first backup is made at once, as the proof that all of it works.

From then on a card shows the last backup, the next, and a history of the last
ten runs. **Back up now** makes one on demand; a pause switch stops the schedule.
Everything under _Manage_ — the schedule, how many to keep, the groups, receipts
— saves the moment it is touched, with no Save button. If a backup stops working
— access revoked, the account full, the server unreachable — a banner says so, in
words, the settings row shows _Needs attention_, and a revoked connection stops
being retried until the owner reconnects it.

**Changing where to back up** starts the same steps again and, once the new place
works, forgets the old one. What the old one already holds stays there.
**Creating a new recovery key** makes later backups open with the new key; the
earlier ones still need the earlier key, and the screen says so before it asks.
The first backup under the new key is made within ten minutes, whatever the
schedule and whether or not anything changed, since until then nothing in the
cloud opens with the key the owner now holds. With receipts on, each is sent
again under the new key ([below](#receipts-if-asked-for)).

### Which groups

The groups the person **owns**. A group they only belong to is not offered: its
data is shared, its owner has not agreed to it leaving on a schedule, and the
owner's own backup already covers it. Ownership is checked again at every run,
so an owner who hands a group over simply stops being asked for it.

New groups are included by default; an owner can leave any out.

### What is in a backup

For each group, exactly what **Export → JSON** produces: people, expenses and
repayments with every payer and share, recurring expenses, and the balances at
that moment. Amounts are integer minor units, so no digit is lost. The same
format restores through the import screen, so there is no second format to
trust.

### Receipts, if asked for

By default a backup holds the data and no receipts, as Export does. An owner can
add them, and the screen says what that means before it lets them:

- **They are bigger than the data.** A group's data is a few hundred kilobytes; its
  receipts can be a gigabyte. They use the owner's cloud quota and upload
  bandwidth, and the screen shows an estimate for the groups ticked.
- **Each receipt is one file, encrypted on its own, sent once per key.** A
  receipt never changes after it is uploaded, so the first backup is the
  expensive one and each later one sends only what is new (usually nothing). They
  sit in a `receipts/` folder beside the backups as
  `receipt-<id>-<key fingerprint>.age`, and the backup file lists which is which
  — inside the ciphertext, so the cloud sees opaque names.
- **A new recovery key sends them all again.** A receipt sent under the old key
  is not one the new key opens, so the first backups under a new key send every
  receipt again, within the budget below, and list the new copies. The old copies
  stay: the backups made under the old key list them. Receipts written before
  their names carried the key's fingerprint (`receipt-<id>.age`, until November 2026) are sent again once in the same way, since nothing records which key they
  were sent under; they too stay where they are.
- **A run has a budget** (256 MB, fifteen minutes). A first backup of thousands of
  receipts carries on in the next run, within the hour, and the card says how many
  are still to go.
- **Balancia never deletes one**, however many backups it keeps. A receipt for an
  expense that was later deleted stays in the cloud until the owner removes it.
- **Restoring one is manual** today. The import restores expenses and not receipt
  files. Decrypt the file each entry of the backup file's `receipts` list names
  (its `object`) with the `age` command and put it back by hand; the list says
  which expense each belongs to and what it was called. Doing that in the browser
  is in `todo/next/`.

## How it is built

```
 owner's browser                   this server                      the cloud
 ───────────────                   ───────────                      ─────────
 makes a key pair
 keeps the private half
 sends the public half  ───────►  stores `age1…` (public)
                                          │
                                  on schedule, in the worker:
                                  export owned groups  (JSON)
                                  gzip
                                  encrypt to `age1…`    ───────►   balancia-backup-
                                  upload through rclone             3f2a9c1b7d4e-
                                                                    20261009T033012Z
                                                                    .json.gz.age
```

- **Encryption is [age](https://age-encryption.org)** (the `age-encryption`
  library, BSD-3-Clause), an audited, specified format with a second
  implementation. A backup written here opens with the plain `age` command, which
  is the point of choosing it: the day Balancia is gone, the files are not.
- **The transport is [rclone](https://rclone.org)** (MIT), a single static binary
  that already speaks every provider offered here and handles their chunking,
  retries and quirks. It is in the image, run as a child process by the worker,
  with a built environment (see below). Writing and maintaining a client per
  provider was the alternative, and the wrong one.
- **The schedule** is a row per destination (`next_run_at`) and a sweep every ten
  minutes that queues the ones that are due. One job writes one backup to one
  destination, so a slow NAS delays only its own owner. A run's end is written
  against the destination as it is then, not as the run found it: a pause, a
  resume, a new schedule or a reconnect made while it ran stays made, the next
  run is counted from the schedule chosen now, and a "run soon" asked for
  meanwhile is kept.
- **A night with no change writes nothing.** Each run hashes what the groups
  hold; if it matches the last good backup, the run is recorded as "unchanged".
  A fresh copy is still written at least once a week, and always when the owner
  presses _Back up now_, so a file deleted from the cloud by hand is not missed
  for long. The recovery key is part of what is hashed, so a night after the
  owner made a new key is never "unchanged".
- **Each file says which destination wrote it.** A backup is named
  `balancia-backup-<tag>-<UTC timestamp>.json.gz.age`, where the tag is the first
  twelve hex digits of the destination's id: random, fixed for the life of the
  destination, and telling the cloud nothing about the person. Two owners who
  point their backups at the same bucket or folder, one owner's two
  destinations, or two installations sharing a Nextcloud, therefore never write
  the same name, even in the same second.
- **Retention** deletes the oldest backups beyond the number the owner chose, and
  _only this destination's own_: files whose names match the pattern above
  exactly, with its own tag. A README, a copy made by another tool, a renamed
  file, another destination's backups in the same folder: none count, none are
  touched. It runs after the new backup is written, never before. The restore
  list offers the same files, and never another destination's.
- **Backups from before the tag** (`balancia-backup-<UTC timestamp>.json.gz.age`,
  written until November 2026) cannot say whose they are. Retention deletes one
  only when this destination's own run history records writing it, and no other
  destination's history records the same name; the history keeps a
  destination's thirty most recent runs, so older files, files written by a
  destination since removed, and files from another installation are **left in
  place for the owner to remove by hand**. They stay on the restore list, since
  they may be the owner's only copies of those weeks, and open only with the key
  that wrote them.

### What leaves the server, and what stays

| Where                  | What it holds                                                                                                                 |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| This server's database | The _public_ key; each destination's credentials, **sealed**; a history of runs (times, sizes, outcomes). No backup contents. |
| The cloud              | Ciphertext, named by time. The names carry no group names, and the sizes are the only thing it learns.                        |
| The owner              | The recovery key.                                                                                                             |

Credentials (a refresh token, a secret access key, an app password) are sealed
with AES-256-GCM under a key derived from `AUTH_SECRET`, the same box that holds
group join links. A copy of the database alone yields none of them. Rotating
`AUTH_SECRET` makes them unreadable: every destination then asks to be
reconnected, and nothing already in the cloud is affected.

A provider may hand back a new refresh token each time the old one is used
(Microsoft does). Whenever that happens — proving a new connection, a
reconnect, or a run — the new one is sealed in place of the old, except that a
run never writes over details the owner gave while it was going. Balancia
mints every access token itself and does it again before any rclone call that
the token might not outlast, a quarter of an hour ahead: rclone could refresh
on its own, but with its remote defined by environment variables it has
nowhere to save what it gets back and drops it, which would leave a rotating
provider's connection holding a spent token.

## What it protects against, and what it does not

**It protects against:**

- A cloud provider reading, scanning or leaking the backups. They hold ciphertext.
- A stolen cloud password or token. It opens a folder of files nobody can read.
- A copy of this server's database, or of its disk. The private key was never
  there.
- Losing the server. The backups are somewhere else.

**It does not protect against:**

- **Losing the recovery key.** There is no copy anywhere and no reset: the backups
  become unreadable for everyone, permanently. That is the price of the server
  not being able to read them, and the screen says so once, at the moment the key
  is made. Rotating the key changes what _later_ backups are encrypted to; the
  earlier ones still need the earlier key.
- **A compromised server that is running.** While a backup is being made the
  worker holds the groups in memory, as it does whenever it shows them. Encryption
  protects what has been written, not what is happening.
- **A malicious operator who changes the code.** Someone who runs the instance
  could ship a build that captures the key as it is made in the browser. The
  recovery key is generated by JavaScript this server serves. If that is not an
  acceptable trust assumption, generate the key yourself with `age-keygen` on a
  machine you control and paste only the `age1…` line under _Use my own key_.
- **Metadata.** The cloud sees when backups happen and how big they are.

## Choosing a destination

| Provider      | How you connect it              | Notes                                                                                                                       |
| ------------- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Google Drive  | Your own app, or a button       | Balancia can see only the files it creates (`drive.file`); it cannot list or read anything else in the Drive.               |
| Dropbox       | Your own app, or a button       | The app is registered as an _app folder_ app, so it is confined to `Apps/<name>/`.                                          |
| OneDrive      | Your own app, or a button       | **Personal Microsoft accounts only.** Microsoft's app folder exists only there. Work and school accounts: use WebDAV or S3. |
| S3-compatible | Address, bucket, key            | AWS, Backblaze B2, Wasabi, Cloudflare R2, MinIO, Hetzner, Scaleway, Infomaniak Swiss Backup, and the rest of rclone's list. |
| WebDAV        | Address, folder, user, password | Nextcloud, ownCloud, Synology, Infomaniak kDrive, any WebDAV. Use an **app password**, not the account's main one.          |
| Proton Drive  | Username, password, 2FA secret  | _Experimental._ See below.                                                                                                  |
| iCloud Drive  | —                               | **Not offered yet.** See below.                                                                                             |

**Infomaniak.** kDrive is reached over WebDAV, on the plans that include it (the
free tier and the lowest ones do not; Infomaniak's page for your plan says).
Swiss Backup is S3- and Swift-compatible; take the address and keys from its
dashboard, since it names them per backup slot. Infomaniak does not support
third-party tools, so a problem is diagnosed from this side first.

**A bucket or WebDAV folder you make just for this is the best choice.** Give the
key permission to write and delete in that one place and nothing else; the
connection test then tells you before the first night whether it can.

### Use your own app

Google Drive, Dropbox and OneDrive will not let any program write to someone's
files without being registered with them first: a registration is a **client ID**
and a **client secret**, and it is what the person is shown on the provider's
consent page ("Balancia wants to…"). Someone has to make it. There are two ways
to settle who, and Balancia supports both:

- **Your own app (works everywhere).** You make the registration in your own
  account at the provider, once, in a few minutes, and paste its client ID and
  secret into the wizard. Nothing is needed from whoever runs the server, and
  nobody else's backups depend on your app: if its secret is reset or the app is
  deleted, only your connection stops. The server keeps the secret sealed with
  the rest of your connection's details (AES-256-GCM, like a bucket's key), never
  sends it back to a browser, and uses it for your connection alone.
- **The server's app (one button).** If whoever runs the server has registered an
  app for everyone ([below](#giving-everyone-one-button)), the wizard shows a
  button, and your own app is still there, folded under it, if you would rather
  not depend on theirs.

Either way the refresh token is yours, in your connection, and Balancia can see
only what the narrowest permission each provider offers lets it see.

What to do at each, with the address the wizard shows you as the redirect (it is
`<this server's address>/api/backup/oauth/<google|dropbox|microsoft>/callback`,
and must match exactly). The consoles move their menus around; the names below
are what to look for.

**Google Drive.**
Google Cloud Console → a project → _APIs & Services_ → enable the **Google Drive
API** → _OAuth consent screen_ (External) → add the scope
`https://www.googleapis.com/auth/drive.file` → _Credentials_ → _OAuth client ID_,
type **Web application**, with the redirect address. Paste the **Client ID** and
**Client secret**.
**Publish the consent screen** ("In production"). An app left in _Testing_ is
issued refresh tokens that expire after seven days, and every backup would break
weekly. `drive.file` is one of Google's non-sensitive scopes, which is what keeps
this from needing a verification review; Google may show "this app isn't
verified" on the consent page, which for your own app is expected.

**Dropbox.**
Dropbox App Console → _Create app_ → **Scoped access** → **App folder** → a name.
_Permissions_: `files.metadata.read`, `files.metadata.write`, `files.content.read`,
`files.content.write`, `account_info.read`. _Settings_: add the redirect address.
Paste the **App key** and **App secret**. A new app is in _development_ status,
which allows the account that made it and a few others; for your own backups
that is enough.

**OneDrive.**
Microsoft Entra admin center → _App registrations_ → _New registration_ →
supported account types **Personal Microsoft accounts only** → redirect address,
platform **Web**. _Certificates & secrets_ → a new client secret (**it expires**;
put the date in your calendar). _API permissions_ → Microsoft Graph, delegated:
`Files.ReadWrite.AppFolder`, `User.Read`, `offline_access`. Paste the
_Application (client) ID_ and the secret's **value**, not its ID.

**When the provider turns the app away.** A reset secret, a deleted app or a
mistyped value is answered with `invalid_client`. That is not a revoked
connection and is not retried (an hour later it would be refused the same way,
and repeated refusals are how accounts get flagged): the card says
"{provider} does not accept the app this connection was made with", and
_Reconnect_ takes you back through the wizard to enter the new details. The
destination's schedule and choices carry over; the earlier backups stay where
they are.

### Experimental: Proton Drive

Proton Drive is off unless the operator sets `BACKUP_EXPERIMENTAL_PROVIDERS`. It
is offered because people asked and rclone can do it, with eyes open:

- Proton publishes no interface for this. rclone's support is built by reading
  Proton's own clients and watching their traffic. It works today, and may stop
  working the day Proton changes something.
- It needs the account's **password kept on this server** (sealed, like every
  credential), because there is no token to hold instead. An account with
  two-factor needs the authenticator's _secret_ (the long string behind the QR
  code), not a six-digit code, which would expire before the first night.
- Use an account you can afford to have locked for a day, not your main one.

### Not offered: iCloud Drive

rclone can reach iCloud Drive, and the credential shape and the mapping to rclone
are in the code. It is not offered, on purpose:

- Signing in takes an interactive two-factor handshake: Apple sends a code to a
  device, and rclone turns it into a trust token and cookies. Nothing in this
  repository can complete that handshake without an Apple account, so nothing
  here has been able to test it, and code that handles Apple passwords should not
  ship untested.
- What it would produce is a backup that depends on a manual step: Apple's trust
  token lasts about thirty days, after which someone has to sign in again with a
  new code, and it does not work at all with Advanced Data Protection on. A
  backup that needs a monthly chore will, sooner or later, miss one.

If it is wanted, the shape of the work is a two-step form (password, then code)
driving rclone's `config create --non-interactive` state machine, a monthly
"sign in again" path that reuses the reconnect flow, and a month of watching
whether the token really lasts. It is in `todo/next/`.

## Restoring

**Settings → Data → Cloud backup → Restore a backup.** Pick the file (upload the
`.age` file you downloaded from your cloud, or choose one from the list when the
destination is connected), and paste or drop your recovery key.

Decryption happens **in your browser**. The key is not sent anywhere, and the
file, if it came through this server, was ciphertext on the way — passed on as it
arrived from the cloud, never held whole. A file larger than 64 MiB is not passed
on at all (a backup is a few megabytes after years of use; one that size would
have been several hundred megabytes of JSON to write): download it from your
cloud and open it here or with `age` as below. You get the
groups found in the backup, each with **Download as JSON**. Create a group for it
and use _Import a backup_ in group settings; the details, and what does and does
not come back, are in [data-migration.md](data-migration.md#restoring-a-balancia-backup).

### Without Balancia

The file is plain age, gzipped JSON inside:

```bash
age --decrypt --identity recovery-key.txt balancia-backup-3f2a9c1b7d4e-20261009T033012Z.json.gz.age \
  | gunzip > backup.json
```

`recovery-key.txt` is the file holding the `AGE-SECRET-KEY-1…` line. `backup.json`
has a `groups` array; each element is a group exactly as Export writes it.

## Running it (operators)

### What the image carries

`rclone` is copied into the image from the project's own, at a pinned version
(`RCLONE_VERSION` in the `Dockerfile`). It adds about 75 MB to the image on disk.
The worker runs it as the unprivileged user, one child process per operation,
with:

- an environment built from nothing — `PATH`, a scratch directory, proxy and
  certificate settings if you set them, and that one remote's settings. It never
  sees `AUTH_SECRET` or `DATABASE_URL`;
- no secrets in its arguments, which would show in `ps`: passwords go on stdin or
  in the environment;
- a scratch directory made for the call and removed after it;
- a deadline, after which it is killed;
- output scrubbed of every secret it was given before anything is stored or shown.

A native install without Docker needs `rclone` on `PATH` (or `BACKUP_RCLONE_PATH`).
Without it the feature says it is unavailable rather than failing at night.

### Giving everyone one button

**Optional.** Google Drive, Dropbox and OneDrive work on every server without
this: each owner brings an app of their own ([above](#use-your-own-app)), and
nothing here has to be set. Registering one for the whole server only turns that
into a single button, and it trades something away, so decide it knowingly:

- every person's connection then runs through **your** app, so its quota, its
  review status and its secret are shared by all of them. A reset secret, a
  consent screen left in _Testing_ or a lapsed Microsoft secret stops everybody's
  backups at once;
- Dropbox keeps a new app in _development_ status, which limits how many
  accounts can link it, until you apply for production;
- the secret lives in this server's environment, which is one more thing to keep.

If that suits you, make the registration with the steps above (the redirect
address is `<APP_URL>/api/backup/oauth/<google|dropbox|microsoft>/callback`, and
`APP_URL` must be the address people use) and set both halves for each provider
you want a button for:

| Provider | Client ID                    | Client secret                    |
| -------- | ---------------------------- | -------------------------------- |
| Google   | `BACKUP_GOOGLE_CLIENT_ID`    | `BACKUP_GOOGLE_CLIENT_SECRET`    |
| Dropbox  | `BACKUP_DROPBOX_CLIENT_ID`   | `BACKUP_DROPBOX_CLIENT_SECRET`   |
| OneDrive | `BACKUP_MICROSOFT_CLIENT_ID` | `BACKUP_MICROSOFT_CLIENT_SECRET` |

Dropbox's _app key_ is the client ID; Microsoft's is the _Application (client)
ID_, and its secret is the secret's **value**. Both halves or neither: one alone
is ignored. A connection made through the button keeps using this app, so
changing or removing it later stops those connections, not the ones made with
somebody's own app. Administration → Cloud backup providers shows which of the
three has a button.

### Local-network destinations

Backing up to a NAS is the commonest reason to run this at home. It needs
`BACKUP_ALLOW_PRIVATE_ENDPOINTS=true`, and it is a real decision: the address is
typed by whoever owns a group, and the worker connects to it every night. With the
setting on, any account can make this server connect to any address it can reach.
Off, such an address is refused, and so is a public-looking name that resolves
into a private range. Plain `http://` is accepted only for addresses that are
private; the password would otherwise cross the internet unencrypted. The platform
metadata addresses are refused either way: the whole link-local range
(`169.254.0.0/16`, `fe80::/10`), AWS's `fd00:ec2::254` and Alibaba's
`100.100.100.200`. They are compared as numbers, not as text, so an IPv6 spelling
that carries one of them (`[::ffff:a9fe:a9fe]`, `[64:ff9b::a9fe:a9fe]`) is
refused like the address itself. An S3 region is letters, digits and hyphens only,
since with no endpoint rclone builds the host name out of it.

Two things this check cannot do, both because it judges the address once and
rclone then makes its own connections:

- **DNS rebinding.** A name that answers differently between the check and
  rclone's own lookup a moment later is not caught, because rclone cannot be
  handed a pre-resolved address.
- **Redirects.** rclone follows a redirect from a WebDAV or S3 server to any
  other address, and has no option to stop it (checked against rclone 1.76: 301,
  302, 307 and 308, WebDAV and S3 alike). So a public server that answers
  "moved, try `http://10.0.0.5/…`" makes the worker send that request, which the
  check never sees. What does hold: the credentials stay behind — rclone drops
  the `Authorization` header when a redirect leaves the host, and Balancia never
  sets WebDAV's `auth_redirect`, which would keep it (`rclone.test.ts` checks
  this against the real binary). And from **rclone 1.76** a redirect from
  `https://` to `http://` is refused unless `--allow-https-downgrade` is passed,
  which Balancia never does; that is what keeps a public HTTPS endpoint from
  bouncing the worker to a metadata service, which answers on plain HTTP only.
  The image pins **1.75.2**, which follows that downgrade too, so until
  `RCLONE_VERSION` is raised the metadata service is reachable this way,
  without credentials, by anyone who can create a destination. The request is
  blind — what comes back reaches the owner only as a scrubbed, shortened error
  — but it is a request this server should not make. Closing both for good needs
  rclone's connections to pass through something that checks every address it
  actually dials, such as a filtering proxy of Balancia's own on loopback.

Keep `BACKUP_ALLOW_PRIVATE_ENDPOINTS` off unless the people with accounts are
people you would give a shell.

### When something goes wrong

Each failed run records a code and the provider's own words, scrubbed and cut to
a few hundred characters, in the card's history. Scrubbed means every password,
key, token and client secret the connection holds is taken out by value, as typed
and as rclone was handed it, and then anything shaped like one; the address,
region, user name and folder stay, because they are what tells you which setting
is wrong. The worker logs the code and the destination, never a credential. The
codes:

| Code               | Meaning                                                                                         | What happens next                                |
| ------------------ | ----------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `reconnect`        | The provider no longer accepts the credentials.                                                 | Retries stop until the owner reconnects.         |
| `app`              | The provider does not recognise the app (client ID and secret) the connection was made through. | Retries stop until the owner enters new details. |
| `forbidden`        | Signed in, but not allowed to write or delete there.                                            | Retried: an hour, two, four, up to a day.        |
| `quota`            | The account or bucket is full.                                                                  | Retried the same way.                            |
| `not_found`        | The bucket or folder does not exist.                                                            | Retried the same way.                            |
| `unreachable`      | No route, refused, timed out, bad certificate.                                                  | Retried the same way.                            |
| `rate_limited`     | The provider asked us to slow down.                                                             | Retried the same way.                            |
| `endpoint_blocked` | This server refuses that address.                                                               | Retried; fix the setting or the address.         |
| `unavailable`      | `rclone` is missing, or the provider is not enabled here.                                       | Retried.                                         |
| `no_key`           | There is no recovery key to encrypt to.                                                         | Retried.                                         |
| `interrupted`      | The server stopped before the run finished: a restart, an update, a process that died.          | Not counted as a failure; runs at its next turn. |

After three failures in a row the card raises a banner.

Runs are queued and the worker takes them one at a time, so a run's clock starts
when the worker picks it up, not when it was queued. A server that is stopped
while a run is going — a restart, an update — gives it the usual twenty seconds
to finish and then closes it as `interrupted` before it exits, so "Back up now"
works again as soon as the server is back. A process that dies outright cannot
do that: its run is closed the same way two hours after it started. So is a run
that waited two hours in the queue without a worker reaching it; the sweep queues
a fresh one straight after, and the old job, if it is ever reached, finds its run
closed and does nothing. A run that has been closed is never reopened by the job
that held it finishing late.

### Raising the rclone version

Change `RCLONE_VERSION` in both Dockerfiles, read rclone's changelog for the
backends in `src/modules/backup/providers.ts`, and run `pnpm test:unit`, which
includes a suite that runs the real binary against local WebDAV and S3 servers.
The two experimental backends track interfaces nobody documents, so read their
entries twice.

## Checklist: what has not been run against the live providers

The Google, Dropbox and Microsoft requests follow each provider's published
reference and are tested against the shapes of their answers; the transport is
tested against real rclone, serving real WebDAV and S3 on localhost. What no
test in this repository has done is sign in to a real account. Before relying on
a provider, do this once with an account you can spare:

- [ ] Connect it. The card names the account.
- [ ] The first backup finishes, and a file appears where it should
      (`Balancia Backups/balancia-backup-….json.gz.age`).
- [ ] Download that file and open it with `age --decrypt` and your recovery key.
- [ ] Press _Back up now_ twice; keep-last-N deletes only the oldest.
- [ ] Revoke the app in the provider's security page. The next run fails with
      "reconnect", and the card offers it.
- [ ] Do the above once through an app of your own, and once through a server-wide
      button if you registered one. Then reset the secret in the provider's
      console: the next run fails with `app` (not `reconnect`), the card says the
      provider does not accept the app, and _Reconnect_ opens the wizard.
- [ ] **OneDrive only:** confirm the file is inside the _Apps/<your app>_ folder.
      rclone is pointed at that folder by its ID, which is the one thing here that
      could not be exercised without a Microsoft account.
- [ ] **Google only:** after a week, confirm backups still run (this is what a
      consent screen left in _Testing_ breaks).

## Where the screens came from

The screens were drawn first, in Claude Design, and the decisions behind them are
in [design/cloud-backup.md](design/cloud-backup.md).
