# Running a demo

A demo instance lets somebody try Balancia — really try it, adding expenses and
settling up — without an account and without touching your data. It is the same
application, served by a container that has no database.

```
Sign in with   demo / demo
```

## What a visitor gets

Their own account, minted the moment they click the button, holding a copy of
the workspace `pnpm db:seed` creates: a Lisbon trip that converts every currency
to EUR, a flat share that keeps currencies apart, one expense per split method,
a multi-payer expense, a settlement, a recurring rent template and the activity
history all of that produces.

It is a copy, not a shared account. Two people trying the demo at the same time
are two accounts with two sets of groups, and neither can reach the other's —
not by filtering, but because `authorizeGroup` has always been the only way into
a group and neither is a member of the other's. The same code that keeps two
real accounts apart keeps two visitors apart.

Their demo is swept after two hours. Restarting the container sweeps all of
them at once.

## What it runs on

Nothing. That is the point.

`DEMO_MODE=true` replaces the connection to PostgreSQL with **PostgreSQL
compiled to WebAssembly, running inside the Node process**
([`@electric-sql/pglite`](https://pglite.dev)). At startup the container applies
every file in `drizzle/` to it — the same migrations a real deployment runs, in
the same order — and `getDb()` hands that database to every query for the life
of the process.

So there is no database service to run, no volume to mount, no backup to think
about and no cleanup job to get wrong. There is also no way for a demo visitor's
expense to reach your real data, because the container holds no credentials for
it.

Real Postgres rather than a mock is what keeps this honest. The balance engine's
window functions, the transactions behind every expense, the `bigint` money
columns and the calendar-date handling all behave exactly as they do in
production, because they _are_ what runs in production. A demo built on a
hand-written fixture layer drifts from the product within a release or two; this
one cannot.

### What it costs, and what it does not have

Every visitor's groups are rows in this process's memory. The application caps
concurrent demos and sweeps expired ones before minting a new one, and
`compose.demo.yaml` sets `mem_limit` as a backstop. A demo session is a few
hundred rows; the schema itself is the larger part, and there is only one of it.

PGlite is a single connection with no pool, so queries serialise. At demo
traffic this is not felt.

No background jobs run: pg-boss keeps its queues in a real database. Recurring
expenses are therefore never generated from their templates and notifications
are never delivered. The template is visible on the recurring screen, which is
what a visitor is there to see.

Exchange-rate suggestions are left on. The rate cache lives in the in-memory
database, which every visitor shares, so it costs one request to
api.frankfurter.dev per currency pair per process rather than one per visitor.
Turned off, the dashboard opens with "Rates unavailable" and cannot add a
position up across two currencies, which is one of the things people came to
look at. `DEMO_EXCHANGE_RATE_PROVIDER=none` runs the demo with no outbound
requests at all.

## Setting one up

Two deployments, two settings. They can share a host: the demo needs no
database, so it is one container beside the stack you already run.

### The demo, in a checkout of its own

A second clone rather than a second Compose file in the first, because the two
move independently — the demo can sit on a release while main goes on, and a
rebuild of one should never touch the other. That is also why it builds
`balancia:demo` rather than the `balancia:local` tag `compose.yaml` uses.

```bash
git clone https://github.com/sebitr/balancia.git ~/balancia-demo
cd ~/balancia-demo
```

Write `.env` by hand — `./scripts/bootstrap.sh` is for an instance with a
database, and this one has none:

```bash
COMPOSE_FILE=compose.demo.yaml
DEMO_APP_URL=https://demo.example.com
DEMO_AUTH_SECRET=<openssl rand -hex 32>
DEMO_EXIT_URL=https://balancia.example.com
DEMO_PORT=3001
```

`DEMO_EXIT_URL` is the way back to your real instance. A demo has no homepage
of its own — opening `/` goes straight to the sign-in screen, since anyone
arriving followed a link that already made the pitch — so signing out has
nowhere to return to. Leave it unset and signing out lands on that same sign-in
screen, which reads as though it did not work.

`COMPOSE_FILE` is what lets every ordinary `docker compose` command in this
directory mean the demo stack, with no `-f` to remember — the same trick
`compose.image.yaml` documents. It is also what makes the deploy script work
here unchanged:

```bash
docker compose up -d --build          # first time, from the server
./scripts/deploy.sh -C balancia-demo  # afterwards, from your machine
```

`deploy.sh` pulls from origin and rebuilds, so the demo ships what is merged,
exactly like the real instance.

### The reverse proxy

Point `demo.example.com` at `DEMO_PORT`, with TLS. In Caddy that is the whole
change:

```caddyfile
demo.example.com {
    reverse_proxy localhost:3001
}
```

A subdomain rather than a path on the main site is deliberate: session cookies
are host-only, so the demo's cookie and a real session's cannot collide in the
same browser. Somebody can be signed into both at once and neither notices.
`X-Forwarded-For` matters here as much as on the real instance — it is what the
rate limit in front of the demo button keys on.

### The link, on the real instance

```bash
DEMO_URL=https://demo.example.com
```

That is what puts "Try the demo" on the homepage, beside "Create an account".
`./scripts/bootstrap.sh` asks for it. Leave it unset and no link appears, which
is the right default for a private instance. Deploy the real instance again for
it to show.

## Trying it locally

```bash
DEMO_MODE=true pnpm dev
```

No database needs to be running. The startup log says
`Demo database ready (in-memory PostgreSQL; nothing is persisted)` once the
migrations are applied, which takes about a second.

The dev Compose stack can do it too — `DEV_DEMO_MODE=true` in `.env` — though
that stack has a real database and seed data in it already, which is usually
what you want as a developer.

## The dataset

`src/modules/demo/dataset.ts`, and it is the same function `scripts/seed.ts`
calls. Changing what a developer sees after `pnpm db:seed` changes what the
public demo shows, deliberately: the alternative is two datasets, one of which
quietly stops being representative.

Everything in it is created through the ordinary service layer rather than by
direct insert, so the rows carry the activity history, balances and derived
state the real flows produce. A demo assembled from raw inserts looks right on
the group screen and empty everywhere else.

## Where the code is

| Thing                          | File                              |
| ------------------------------ | --------------------------------- |
| The in-memory database         | `src/lib/db/demo-database.ts`     |
| The one branch that selects it | `src/lib/db/client.ts` (`getDb`)  |
| Startup                        | `src/instrumentation.ts`          |
| Minting and sweeping visitors  | `src/modules/demo/sessions.ts`    |
| The `demo` / `demo` credential | `src/modules/demo/credentials.ts` |
| The dataset                    | `src/modules/demo/dataset.ts`     |
| The banner and the way in      | `src/components/demo/`            |

The whole of demo mode, as far as the rest of the application is concerned, is
one `if` in `getDb()`. Nothing in `src/modules/` knows a demo exists.
