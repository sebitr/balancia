# Translations

Balancia ships English and French. Every word either language shows lives in
`messages/en.json` and `messages/fr.json` — the interface, the emails, the push
notifications, the error states.

Editing those files by hand is the right move for one word. It is the wrong
move for a sweep across a hundred strings, where the work is not typing but
keeping two files in step, and it was never an option at all for someone who
wants to give Balancia their language but does not want to open an editor.

`compose.weblate.yaml` runs [Weblate](https://weblate.org) on your machine for
both of those. It shows every string with its English source beside it, a
progress bar per language, and a button that starts a new one.

Nothing leaves the machine. The instance is bound to `127.0.0.1`, registration
is closed, and no machine-translation service is configured — it is a local
editor for local files, in keeping with the rest of the project.

## Before the first run

Docker, and about 2 GB of memory free. The stack is Weblate, a PostgreSQL of
its own and a Valkey; it is entirely separate from `compose.dev.yaml`, and the
two can run at once or not at all.

## Start it

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

## Change some wording

Open the component, pick a language, and translate. English is editable too —
it is the base file, so changing an English string there is how the source
wording changes.

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

which puts the merged state back under Weblate, so the next translator starts
from what actually shipped.

## Add a language

Use **Start new translation** in Weblate, pick the language, translate, and
`pnpm weblate pull` as above. Weblate writes a new `messages/<code>.json`.

The app will not load it yet, and `pnpm test` says so:

```
message catalogues > loads every catalogue that messages/ contains
  expected [ 'de', 'en', 'fr' ] to deeply equal [ 'en', 'fr' ]
```

A locale is registered in six places. The first is the list itself; the other
five are `Record<AppLocale, …>` maps, so once the code is in `LOCALES`,
`pnpm typecheck` names them one at a time until they are all filled in.

| File                                        | What to add                                                                      |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/i18n/locales.ts`                       | the code in `LOCALES`, and the language's own name for itself in `LOCALE_LABELS` |
| `src/i18n/request.ts`                       | a `MESSAGE_LOADERS` entry importing the new JSON                                 |
| `src/i18n/emails.ts`                        | the catalogue in `CATALOGUES`, for mail and push sent from the worker            |
| `src/components/pwa/offline-notice.tsx`     | the offline copy, which the service worker needs without a request               |
| `src/components/i18n/language-switcher.tsx` | a flag in `LOCALE_FLAGS`                                                         |
| `tests/helpers/intl.tsx`                    | the catalogue, so tests can render in it                                         |

Then `pnpm test` again: the same file checks that every key English defines is
translated, that the ICU placeholders match, and that nothing was left in
English by accident. A language ships when it is complete.

Codes are lower case — `pt-br`, not `pt-BR`. `negotiateLocale` lower-cases what
the browser sends before comparing, so a capital in `LOCALES` is a locale
`Accept-Language` can never select; `Intl` canonicalises the tag on its own, so
nothing is lost by writing it this way. The component is configured to name
files that way, so Weblate gets it right without being asked.

## Where the git goes

Weblate works on a git repository. It must not be this one: it would commit
onto whichever branch you had checked out, which is the opposite of what
`AGENTS.md` asks of everything else here.

So it gets a bare mirror of its own, at `.weblate/balancia.git` — ignored by
git, owned entirely by `scripts/weblate.sh`, and holding a scratch copy of
`origin/main`.

```
origin/main ──sync──▶ .weblate/balancia.git ──clone──▶ Weblate
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

## How the component is configured

`scripts/weblate-component.json` is the definition, applied on every
`pnpm weblate up`. It is tracked so that the settings below are reviewable in a
diff rather than clicked into a form somewhere.

| Setting                | Value                | Why                                                                                                                    |
| ---------------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| File format            | `json-nested`        | `messages/*.json` are nested objects, not flat dotted keys                                                             |
| File mask              | `messages/*.json`    |                                                                                                                        |
| Base file              | `messages/en.json`   | English is the source, as it is for `next-intl.d.ts`                                                                   |
| Edit base file         | yes                  | so English wording can be changed here too                                                                             |
| Translation flags      | `icu-message-format` | next-intl messages are ICU, so Weblate checks `{count, plural, …}` in the editor rather than leaving it to `pnpm test` |
| Adding new translation | create a file        | the button this page is about                                                                                          |
| Language code style    | BCP, lower case      | see above                                                                                                              |
| Manage strings         | no                   | keys come from the code, not from translators                                                                          |

Two more settings are applied by the script rather than the file: JSON
indentation of two spaces, because Weblate's writer defaults to four and
prettier would rewrite every file it saved; and the **Cleanup translation
files** add-on, which drops keys English no longer has — the other half of what
`src/i18n/messages.test.ts` checks.

## Stop it

```bash
pnpm weblate down     # keeps everything; `up` brings it back as it was
pnpm weblate reset    # deletes the database, the clone and the mirror
```

`reset` asks first, and takes anything translated but never pulled with it.

## When something is wrong

**`the Docker daemon is not reachable`** — start Docker Desktop, or
`colima start`.

**It never answers on 8090.** `pnpm weblate logs`. A first run migrating a
fresh database is slow but not silent; `WEBLATE_TIMEOUT` raises the ten minutes
the script waits.

**Weblate cannot push: permission denied.** The mirror is a bind mount, and the
container's git runs as a different user than the one that created it.
`chmod -R a+rwX .weblate` fixes it, and `pnpm weblate sync` does that anyway on
every run.

**A pull brought back reformatted JSON.** The indentation setting did not
apply — the message from `pnpm weblate up` will have said so if the image
predates Weblate 5.13. `pnpm format` puts it right either way.

## Or just edit the files

Weblate is a convenience, not a gate. `messages/en.json` and `messages/fr.json`
are ordinary files in the repository; for a typo, editing both and running
`pnpm test` is faster than starting a container, and the result is identical.
