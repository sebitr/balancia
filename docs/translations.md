# Translations

Balancia ships English and French. Every word either language shows lives in
`messages/en.json` and `messages/fr.json` — the interface, the emails, the push
notifications, the error states.

There are two ways in, and which one you want depends on who you are. If you
would like to give Balancia a language it does not have, or fix a phrase that
reads wrong in one it does, everything you need is in a browser and the next
section is the whole story. If you maintain Balancia and want to sweep a
hundred strings without publishing a half-finished rewrite while you work,
there is a Weblate that runs on your own machine, further down.

## Help translate Balancia

Balancia's translations live on
[Hosted Weblate](https://hosted.weblate.org/engage/balancia/), free software's
translation platform, which hosts libre projects at no charge.

<https://hosted.weblate.org/engage/balancia/>

You do not need to know git, install anything, or open an editor. Weblate shows
every string with its English source beside it, one at a time, with a box to
type the translation into. You can start without an account to see the state of
a language; saving a translation needs one, and signing in with GitHub works if
you have that already.

What you write is not published as you type. Weblate collects translations and
opens a pull request against this repository, which a maintainer reads and
merges like any other change. Your name stays on the commits.

Two things are worth knowing before you start:

- **English is read-only there.** `messages/en.json` is the source that the
  TypeScript types are generated from, so changing an English word is a code
  change. If a source string is wrong, misleading or untranslatable, open an
  [issue](https://github.com/sebitr/balancia/issues) — that is a genuinely
  useful report, not a nuisance.
- **The placeholders matter.** A string like
  `{count, plural, one {# expense} other {# expenses}}` is ICU message format:
  the `{count}` and the plural categories have to survive translation, and the
  categories a language needs are not always the two English has. Weblate
  checks this in the editor and will tell you before you save.

## Add a language

Use **Start new translation** in Weblate, pick your language, and translate.
Weblate creates `messages/<code>.json` and the pull request carries it.

A language ships when it is complete. Balancia will not offer a half-translated
interface: `src/i18n/messages.test.ts` requires every key English defines to be
present, so a catalogue with gaps fails CI rather than showing English
sentences in the middle of a translated screen. Partial work is still welcome —
it just waits in the pull request until it is finished, by you or by someone
else.

### What a maintainer does with it

A new catalogue arrives with CI already red, and this is expected rather than
the contributor's mistake:

```
message catalogues > loads every catalogue that messages/ contains
  expected [ 'de', 'en', 'fr' ] to deeply equal [ 'en', 'fr' ]
```

The app does not load a catalogue it has not been told about. Registering one
touches six files — the first is the list itself, and the other five are
`Record<AppLocale, …>` maps, so once the code is in `LOCALES`, `pnpm typecheck`
names them one at a time until they are all filled in.

| File                                        | What to add                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/i18n/locales.ts`                       | the code in `LOCALES`, and the language's own name for itself in `LOCALE_LABELS` |
| `src/i18n/request.ts`                       | a `MESSAGE_LOADERS` entry importing the new JSON                                 |
| `src/i18n/emails.ts`                        | the catalogue in `CATALOGUES`, for mail and push sent from the worker            |
| `src/components/pwa/offline-notice.tsx`     | the offline copy, which the service worker needs without a request               |
| `src/components/i18n/language-switcher.tsx` | a flag in `LOCALE_FLAGS`                                                         |
| `tests/helpers/intl.tsx`                    | the catalogue, so tests can render in it                                         |

Push those onto the contributor's branch, or land them in a commit of your own
on top. Then `pnpm test` again: the same file checks that every English key is
translated, that the ICU placeholders match, and that nothing was left in
English by accident.

Codes are lower case — `pt-br`, not `pt-BR`. `negotiateLocale` lower-cases what
the browser sends before comparing, so a capital in `LOCALES` is a locale
`Accept-Language` can never select; `Intl` canonicalises the tag on its own, so
nothing is lost by writing it this way. Both components are configured to name
files that way, so Weblate gets it right without being asked.

## The local Weblate

`compose.weblate.yaml` runs a second Weblate on your own machine, against the
same files. It is for the maintainer's half of the job: rewording a screen,
re-reading a language end to end, trying a phrasing across a dozen strings —
work that has no business being visible to contributors while it is in
progress.

Nothing leaves the machine. The instance is bound to `127.0.0.1`, registration
is closed, and no machine-translation service is configured.

### Before the first run

Docker, and about 2 GB of memory free. The stack is Weblate, a PostgreSQL of
its own and a Valkey; it is entirely separate from `compose.dev.yaml`, and the
two can run at once or not at all.

### Start it

```bash
pnpm weblate up
```

First run pulls the image and migrates a fresh database, so give it a few
minutes. When it finishes it prints the address:

|         |                         |
| ------- | ----------------------- |
| Weblate | <http://localhost:8090> |
| Sign in | `admin` / `weblate`     |

Set `WEBLATE_PORT` if 8090 is taken. Both the compose file and the script read
it, and it also settles the site domain Weblate builds its links from.

`pnpm weblate up` is safe to re-run, and is how a change to
`scripts/weblate-component.json` reaches an instance that already exists.

### Change some wording

Open the component, pick a language, and translate. English is editable here,
unlike on the public instance — it is the base file, so changing an English
string is how the source wording changes.

When you are done:

```bash
pnpm weblate pull
```

That makes Weblate commit what you wrote, brings it back, and writes
`messages/` into your working tree. Nothing is staged and nothing is committed:
you get an unstaged diff to read.

```bash
git diff -- messages
pnpm test
```

Then commit on your own branch and open a pull request, the same as any other
change. Once it merges:

```bash
pnpm weblate sync
```

which puts the merged state back under the local Weblate, so it starts from
what actually shipped.

### Stop it

```bash
pnpm weblate down     # keeps everything; `up` brings it back as it was
pnpm weblate reset    # deletes the database, the clone and the mirror
```

`reset` asks first, and takes anything translated but never pulled with it.

## Where the git goes

The local Weblate works on a git repository, and it must not be this one: it
would commit onto whichever branch you had checked out, which is the opposite
of what `AGENTS.md` asks of everything else here.

So it gets a bare mirror of its own, at `.weblate-mirror/balancia.git` — ignored
by git, owned entirely by `scripts/weblate.sh`, and holding a scratch copy of
`origin/main`.

```
origin/main ──sync──▶ .weblate-mirror/balancia.git ──clone──▶ local Weblate
                                │
                                └────pull────▶ messages/ in your working tree
```

`sync` force-updates the mirror, which is safe because the mirror is the
throwaway end: Weblate's own clone and database hold anything it has not pushed
yet, and it rebases onto whatever `main` has become. After your translation
commits merge into `main`, Weblate's copies of them fall away as
already-applied.

To translate strings that are on a branch rather than in `main`, point it
somewhere else for the run:

```bash
WEBLATE_SOURCE_REF=feat/my-branch pnpm weblate sync
```

The public instance needs none of this. It clones this repository from GitHub
directly and pushes to a branch of its own.

## How the components are configured

Each instance has a component definition tracked in the repository, so that the
settings below are reviewable in a diff rather than clicked into a form
somewhere: `scripts/weblate-component.json` for the local one, applied on every
`pnpm weblate up`, and `scripts/weblate-component-hosted.json` for the public
one, applied through Hosted Weblate's API or its component form.

They agree on everything that decides how `messages/` is read and written, and
`src/i18n/weblate-component.test.ts` fails the build if they stop agreeing —
two components writing the same files differently is how you get a pull request
that reformats every catalogue.

| Setting                | Value                | Why                                                                                                                    |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| File format            | `json-nested`        | `messages/*.json` are nested objects, not flat dotted keys                                                             |
| File mask              | `messages/*.json`    |                                                                                                                        |
| Base file              | `messages/en.json`   | English is the source, as it is for `next-intl.d.ts`                                                                   |
| Translation flags      | `icu-message-format` | next-intl messages are ICU, so Weblate checks `{count, plural, …}` in the editor rather than leaving it to `pnpm test` |
| Adding new translation | create a file        | the **Start new translation** button                                                                                   |
| Language code style    | BCP, lower case      | see above                                                                                                              |
| Manage strings         | no                   | keys come from the code, not from translators                                                                          |

Two settings differ between them, both deliberately:

| Setting        | Local                     | Public                | Why                                                                                                                                         |
| -------------- | ------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Edit base file | yes                       | no                    | English is the source the types are generated from; rewording it is a code change, not a translation                                        |
| Repository     | `/repo/balancia.git`, git | GitHub, pull requests | the local one pushes to the bind-mounted mirror; the public one opens a pull request, which is the only way a stranger's work should arrive |

Two more settings are applied by `scripts/weblate.sh` rather than by the file,
and want setting by hand on the public instance: JSON indentation of two
spaces, because Weblate's writer defaults to four and prettier would rewrite
every file it saved; and the **Cleanup translation files** add-on, which drops
keys English no longer has — the other half of what `src/i18n/messages.test.ts`
checks.

`.weblate` at the repository root is not read by any of this. It is wlc's
configuration — Weblate's command-line client — naming the public project so
that `wlc pull` and friends work in a checkout without arguments. wlc is
optional and is not a dependency of this project.

## Setting the public project up

One-time, and recorded here because a self-hosted fork will want to do the same
thing for its own languages.

1. Apply for the Libre plan at <https://hosted.weblate.org/hosting/>. It is
   free for public projects; Balancia is AGPL-3.0-or-later and public, so it
   qualifies. Approval is a person reading the request, not instant.
2. Connect GitHub from
   <https://hosted.weblate.org/create/component/github-app/>, using the
   **Connect GitHub account** button there, and let it carry you to GitHub and
   back in one go. That one step is how Weblate clones, how it pushes the
   branch it opens pull requests from, and how it hears about a merge — the
   app's installation token carries all three.

   Start it from that page and nowhere else. Installing the app from GitHub's
   own listing puts the installation on your account without ever telling
   Weblate, which leaves you connected to nothing and looking at an empty
   repository list.

   Doing it this way is what makes the other two ways unnecessary: there is no
   `hosted weblate` collaborator to invite, which is only needed for SSH pushes
   outside the app, and no webhook to add by hand, which is only needed for
   components imported without it. A component created without the app pushes
   from a fork of Weblate's own and polls for changes; both work, and both are
   worse to follow.

3. Create the component by importing the connected repository, using
   `scripts/weblate-component-hosted.json` for the field values. The API
   (`POST /api/projects/balancia/components/`) takes the same fields, but the
   import flow is what attaches the component to the app installation —
   afterwards the repository URLs are read-only in the component settings,
   deliberately, so that nobody can point an existing component at somewhere
   else's credentials.
4. Set the JSON indentation and the cleanup add-on, per the section above.
5. Check that the project's licence says AGPL-3.0-**or-later**. Weblate's
   picker offers `AGPL-3.0-only` as well, and it is the wrong one — it is shown
   to every translator before they contribute.

## When something is wrong

**`the Docker daemon is not reachable`** — start Docker Desktop, or
`colima start`.

**It never answers on 8090.** `pnpm weblate logs`. A first run migrating a
fresh database is slow but not silent; `WEBLATE_TIMEOUT` raises the ten minutes
the script waits.

**Weblate cannot push: permission denied.** The mirror is a bind mount, and the
container's git runs as a different user than the one that created it.
`chmod -R a+rwX .weblate-mirror` fixes it, and `pnpm weblate sync` does that
anyway on every run.

**`The Weblate GitHub app installation link is no longer valid.`** The link is
good once and briefly, so a back button, a second tab, or a detour through
GitHub's own app listing spends it. **Connect GitHub account** on the same page
issues a new one; take it straight through. If GitHub then says the app is
already installed, the installation is a leftover from a spent link — open it
under <https://github.com/settings/installations>, either grant it the
repository and connect again, or uninstall it and start over.

**A pull brought back reformatted JSON.** The indentation setting did not
apply — the message from `pnpm weblate up` will have said so if the image
predates Weblate 5.13. `pnpm format` puts it right either way.

**`git checkout` refuses to create `.weblate`.** That name was the mirror's
until the public project needed it, and git cannot write a file where your
checkout still has a directory. `rm -rf .weblate` — nothing reads it any more.
`pnpm weblate pull` first if you have translations in there you never brought
back.

## Or just edit the files

Weblate is a convenience, not a gate. `messages/en.json` and `messages/fr.json`
are ordinary files in the repository; for a typo, editing both and running
`pnpm test` is faster than opening anything, and the result is identical.
