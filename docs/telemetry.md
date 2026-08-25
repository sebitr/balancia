# Telemetry

Balancia collects no telemetry from self-hosted installations by default.
Administrators may opt in to sending coarse anonymous product-usage statistics.
Telemetry does not contain financial data, user-generated content, personal
identifiers, IP addresses, hostnames, or instance URLs, and administrators can
preview the payload before it is sent.

That paragraph is the whole claim, and the rest of this document is what backs
it: the exact fields, where they come from, what enforces the absence of
everything else, and how to switch it all off — or replace it.

---

## 1. Why Balancia has telemetry at all

A self-hosted application has no idea what it is. Nobody can see which features
are used, which are never touched, which PostgreSQL and CPU architectures need
supporting, or whether an option added two versions ago found anybody. The
alternatives are guessing, or asking on the issue tracker and hearing from the
handful of people who read it.

What that does **not** justify is knowing anything about the people using it.
The design here starts from the assumption that Balancia holds the most
sensitive ordinary record a group of friends keeps — who paid for what, and who
owes whom — and that none of it is any of the project's business. Everything
below follows from that.

It also follows that telemetry is worth having only if it is honest. Software
that says "anonymous statistics" and sends an installation identifier is worse
than software that sends nothing, because it spends trust it did not earn.

---

## 2. Defaults

|                                            | Self-hosted default                           |
| ------------------------------------------ | --------------------------------------------- |
| Anonymous usage statistics                 | **off**                                       |
| Anonymous crash reports                    | **off**                                       |
| Local product counters                     | not recorded until usage statistics are on    |
| Public-page counts (§17)                   | **off** — follows the usage-statistics switch |
| Local operational metrics (`/api/metrics`) | **off**, and never transmitted                |
| Collector (`TELEMETRY_RECEIVER`)           | **off** — routes answer 404                   |

Nothing about an upgrade changes this: the switches are stored, both default to
false, and a migration never sets either.

The table above is what an install does when nobody has said otherwise. A
deployment can start with the switches on by setting `TELEMETRY_DEFAULT=true`
(§8), which `scripts/bootstrap.sh` asks about; the first four rows then read
"on from first run", and the last two are separate settings and unaffected.

There are two authorities and they are not equals:

- The **deployment** sets a ceiling with `TELEMETRY_MODE`, which can only ever
  forbid, and the position the switches start in with `TELEMETRY_DEFAULT`.
- The **administrator** sets the state within that ceiling, in the UI. Their
  answer is stored with a timestamp and is the answer from then on — the
  deployment's default is never consulted for that switch again, including
  when the answer is "off".

Effective state is the intersection. This is why an operator can hand out
`TELEMETRY_MODE=off` in a fleet and know it holds whatever anyone clicks.

What this document stopped promising when `TELEMETRY_DEFAULT` was added, since
it is a weaker claim than the one that used to be here: an environment file
_can_ start an instance with reporting on. What it cannot do is override an
administrator who has answered, or survive one answering afterwards. If someone
else set this installation up for you, the administration page shows the live
state rather than the configured one, and turning a switch off there is final.

---

## 3. Exactly what is collected

### The weekly usage report

One request a week, when an administrator has switched usage statistics on.
Every field, with its complete range of possible values:

| Field                             | Values                                                                     |
| --------------------------------- | -------------------------------------------------------------------------- |
| `schema`                          | `1`                                                                        |
| `version`                         | The running Balancia version, e.g. `1.8.2`                                 |
| `deployment`                      | `docker-compose` \| `docker` \| `standalone` \| `development` \| `unknown` |
| `database`                        | `postgresql`                                                               |
| `architecture`                    | `amd64` \| `arm64` \| `other`                                              |
| `instanceAge`                     | `0-7d` \| `8-30d` \| `31-90d` \| `91-180d` \| `181-365d` \| `365d+`        |
| `users`                           | `0` \| `1` \| `2-5` \| `6-10` \| `11-25` \| `26-50` \| `51-100` \| `100+`  |
| `groups`                          | same ladder as `users`                                                     |
| `features.registrationOpen`       | boolean                                                                    |
| `features.email`                  | boolean — whether SMTP is configured                                       |
| `features.push`                   | boolean — whether a VAPID key pair is configured                           |
| `features.appleSignIn`            | boolean                                                                    |
| `features.exchangeRates`          | boolean — whether a rate provider is configured                            |
| `features.receiptScanning`        | boolean                                                                    |
| `features.semanticCategorization` | boolean                                                                    |
| `features.storage`                | `local` \| `s3`                                                            |
| `features.worker`                 | `in-web` (the default stack) \| `separate`                                 |
| `last7Days.*`                     | Bucket labels only — see below                                             |

Every entry under `last7Days` is one of
`0`, `1`, `2-5`, `6-10`, `11-25`, `26-50`, `51-100`, `101-250`, `251-500`,
`500+`:

`groupsCreated`, `expensesCreated`, `expensesUpdated`, `settlementsCreated`,
`recurringExpensesCreated`, `multiCurrencyExpenses`, `expensesWithReceipt`,
`receiptsAttached`, `ocrUses`, `splitwiseImportsStarted`,
`splitwiseImportsCompleted`, `passkeysRegistered`, `invitesCreated`,
`guestsJoined`, `splitMethods.{equal,exact,percentage,shares}`, and
`expenseParticipants` — a distribution whose keys are participant-count buckets
and whose values are count buckets.

That is the complete list. It is not a summary of a longer one.

### The crash report

Sent only if crash reports are separately switched on, at most one per error
class per hour and no more than 24 a day whatever happens:

| Field                                    | Values                                                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `schema`                                 | `1`                                                                                                                                                          |
| `version`                                | The running Balancia version                                                                                                                                 |
| `error`                                  | An error _class name_: `RecurrenceError`, `PostgresError_23505`, `SystemError_ENOSPC`, `UnknownError`                                                        |
| `component`                              | `server-action` \| `route-handler` \| `render` \| `scheduler` \| `job` \| `import` \| `notifications` \| `storage` \| `database` \| `telemetry` \| `unknown` |
| `deployment`, `database`, `architecture` | As above                                                                                                                                                     |

---

## 4. Exactly what is not collected

Not by policy — by construction. Each item below has nowhere to go: no field in
`src/lib/telemetry/schema.ts` can hold it, and no function in
`src/lib/telemetry/index.ts` accepts it as an argument.

Financial data: expense amounts, income and payment amounts, currencies of
individual expenses, balances, settlement amounts, exchange rates.

User-generated content: expense descriptions, merchant names, notes, comments,
group names, participant names, category names, receipt images, text read from
receipts, OCR output, attachment file names, anything from an imported
Splitwise file.

Personal identifiers: email addresses, usernames, display names, user IDs,
group IDs, expense IDs, participant IDs, session IDs, invitation tokens,
authentication tokens, authorization headers, cookies, passkey credentials.

Location and network: IP addresses, geographic location, timezone, locale,
instance hostname, instance URL, domain name, reverse-proxy details.

Request context: request bodies, query strings, full URLs, route paths with
values in them, stack traces, error messages, SQL statements, SQL parameters,
database connection strings.

And no installation identifier of any kind — see §16.

---

## 5. Example reports

A real weekly report from an instance with a handful of people:

```json
{
  "schema": 1,
  "version": "1.8.2",
  "deployment": "docker-compose",
  "database": "postgresql",
  "architecture": "arm64",
  "instanceAge": "91-180d",
  "users": "6-10",
  "groups": "11-25",
  "features": {
    "registrationOpen": false,
    "email": true,
    "push": true,
    "appleSignIn": false,
    "exchangeRates": false,
    "receiptScanning": true,
    "semanticCategorization": false,
    "storage": "local",
    "worker": "in-web"
  },
  "last7Days": {
    "groupsCreated": "1",
    "expensesCreated": "51-100",
    "expensesUpdated": "6-10",
    "settlementsCreated": "6-10",
    "recurringExpensesCreated": "1",
    "multiCurrencyExpenses": "11-25",
    "expensesWithReceipt": "11-25",
    "receiptsAttached": "11-25",
    "ocrUses": "6-10",
    "splitwiseImportsStarted": "0",
    "splitwiseImportsCompleted": "0",
    "passkeysRegistered": "1",
    "invitesCreated": "2-5",
    "guestsJoined": "2-5",
    "splitMethods": {
      "equal": "26-50",
      "exact": "2-5",
      "percentage": "6-10",
      "shares": "1"
    },
    "expenseParticipants": { "2-5": "51-100", "6-10": "2-5" }
  }
}
```

A crash report:

```json
{
  "schema": 1,
  "version": "1.8.2",
  "error": "RecurringExpenseGenerationError",
  "component": "scheduler",
  "deployment": "docker-compose",
  "database": "postgresql",
  "architecture": "arm64"
}
```

---

## 6. Previewing a report

**Settings → Administration → Telemetry** shows the payload this instance would
send, right now, rendered from the object the report builder returns.

There is no example payload in the codebase for that screen to display instead.
`buildUsageReport()` is called by the preview and by the transport, and the
preview renders its return value — so a change that added a field would appear
on that screen the moment it shipped, whether or not anybody remembered to
update this document.

The screen also shows the configured endpoint, when a report was last sent, and
a **Send test report** button. That button is the only path that transmits
outside the weekly schedule; it does nothing unless somebody presses it, and it
reports only "sent" or "failed" — never a response body, a hostname or an
exception, because an administration page is not a place to learn what a
server's internals look like.

The preview is visible whatever the switches say, including when telemetry is
off. Being able to see what _would_ be sent before deciding is the point.

---

## 7. Turning telemetry off

It is off unless somebody asked for it — an administrator moving the switch, or
a deployment setting `TELEMETRY_DEFAULT=true` (§8). Either way:

- **In the UI** — Settings → Administration → Telemetry, and move the switch
  back. Switching usage statistics off also **deletes the local counters**, so
  "off" means the data is gone rather than merely unsent.
- **At the deployment**, which overrides the UI:

  ```bash
  TELEMETRY_MODE=off
  ```

  Restart. Stored opt-ins are ignored, nothing is recorded, no request can be
  made, and the switches are disabled with an explanation rather than silently
  refusing to move.

- **At the network**, if you trust nothing in this repository: Balancia's only
  outbound connections are to `telemetry.balancia.app` (never, unless opted
  in), your SMTP server, the browser vendors' push services, an exchange-rate
  provider, and a receipt-OCR provider if you configured one — each of them
  switched on by you. A default-deny egress policy leaves the application
  working, and blocking that one host is enough to be certain about telemetry
  whatever the settings say.

---

## 8. Environment configuration

See [Environment reference](environment.md#telemetry) for the full text of each
variable.

```bash
TELEMETRY_MODE=opt-in            # opt-in | local | off
TELEMETRY_CRASH_REPORTS=true     # may an admin enable them
TELEMETRY_DEFAULT=false          # where both switches start
TELEMETRY_DEPLOYMENT=docker-compose  # optional label
TELEMETRY_RECEIVER=false         # run the collector
```

**There is no endpoint setting.** The destination is the constant
`https://telemetry.balancia.app` in `src/lib/telemetry/endpoint.ts`.
Configuration decides whether anything is sent, never to whom — an address
that could be set from a form or an environment file would be a
request-forgery lever pointed at your own network, and it would make every
statement in this document conditional on nobody having changed it. A fork
edits that line (§14).

**Precedence, in one sentence:** effective = (the mode allows) AND (the switch
is on), where the switch is what an administrator stored, or `TELEMETRY_DEFAULT`
while none has answered.

`TELEMETRY_MODE=local` is the middle setting: counters are recorded on this
server and the preview works, and nothing is ever transmitted. It is what the
development stack uses, and what an operator who wants the numbers for
themselves can use.

`scripts/bootstrap.sh` asks about telemetry on a first run, as one question
with two answers. The first decides whether an administrator may turn it on at
all: yes writes `TELEMETRY_MODE=opt-in`, no writes `off` and takes the choice
away for good. The second decides where the switches start and writes
`TELEMETRY_DEFAULT`. It defaults to no, so pressing Enter through the whole
wizard still produces an instance that records nothing and sends nothing.

It is asked rather than defaulted silently because an operator who is never
told the feature exists has not consented to anything. The question is the
disclosure, and that is exactly what makes a default acceptable here — and
what would make a silent one not.

---

## 9. Retention

**On the sending instance.** Product counters are rows of
`(day, metric, count)` in `telemetry_counters` — no identifiers, nothing
per-event. The maintenance job deletes anything older than **14 days** (a
seven-day window plus slack for a missed run). Switching usage statistics off
deletes all of them immediately.

**On the collector.** An accepted payload is stored in `telemetry_reports` with
the UTC day it arrived and nothing else about the request. A daily job folds
every stored report into `telemetry_daily_stats` — counts of
`(day, kind, field, value)`, e.g. `last7Days.ocrUses` / `6-10` / 412 — and
deletes the raw rows. Anything not folded is deleted after **7 days** anyway.

Aggregates are kept indefinitely. There is nothing in one that belongs to
anybody: they are counts of bucket labels, with no row that could be traced to
a sender, because no report carries anything that identifies one.

This is a description of what the code does. It is not a legal claim about any
particular regulation, and it is not advice about your obligations as an
operator.

---

## 10. Crash reporting

A separate opt-in, off by default, and only meaningful in `opt-in` mode.

What is transmitted is an error class and a component. What is not transmitted
is everything else the exception was holding — and the reason is that error
objects in an application like this are full of exactly what telemetry must
never see. A `DatabaseError` message quotes the failing statement's parameters,
which here are amounts and email addresses. A failed `fetch` quotes the URL. An
assertion quotes both sides of the comparison.

The classifier is allowlist-shaped, in `src/lib/telemetry/crash.ts`. It starts
from nothing and admits a candidate only if it already looks like an
identifier: `/^[A-Za-z][A-Za-z0-9_]{2,63}$/`. Anything else is rejected
**whole** — it is never stripped of punctuation and kept, because
`john@example.com` with the punctuation removed is `johnexamplecom`, which is
still an address. A rejected value becomes `UnknownError`.

Two exceptions are admitted deliberately, both constants rather than data:
PostgreSQL's five-character `SQLSTATE` (`PostgresError_23505`) and Node's own
error codes (`SystemError_ENOSPC`). "The disk filled up" and "the push service
refused the connection" are the two most useful diagnoses a self-hosted
installation produces, and neither is expressible without them.

**Stack traces are not transmitted, at all.** The risk in sending them, even
sanitised, is that a stack frame's arguments and a bundled build's inlined
values are not something a regular expression can be trusted to clean: one
`at handleExpense (…description="Dinner at Chez Marie"…)` is a leak that no
apology fixes. The cost is real — a class name and a component is much less to
debug from than a trace — and it is accepted. The full error, with its stack,
is written to this instance's own log where an administrator can read it.

Throttling: at most one report per error class per component per hour, and no
more than 24 per instance per day. An application in a crash loop must not turn
itself into a load generator pointed at the collector.

Note that class names may be less informative in a production build, where a
bundler can rename classes. Balancia's own domain errors set `name` explicitly
and survive it; a third-party class may arrive as `UnknownError`.

---

## 11. Local operational metrics

Separate system, separate code, and never transmitted by Balancia: metrics are
for the person who runs the server, looking at their own server.

`METRICS_ENABLED=true` exposes Prometheus text at `/api/metrics`:

| Metric                                                                                                           | Type      | Labels                                                     |
| ---------------------------------------------------------------------------------------------------------------- | --------- | ---------------------------------------------------------- |
| `balancia_http_requests_total`                                                                                   | counter   | `route` (template), `method`, `status` (`2xx`/`4xx`/`5xx`) |
| `balancia_http_request_duration_seconds`                                                                         | histogram | `route`, `method`                                          |
| `balancia_server_action_total`                                                                                   | counter   | `action`, `outcome` (`ok`/`rejected`/`failed`)             |
| `balancia_server_action_duration_seconds`                                                                        | histogram | `action`                                                   |
| `balancia_job_total`                                                                                             | counter   | `queue`, `outcome`                                         |
| `balancia_job_duration_seconds`                                                                                  | histogram | `queue`                                                    |
| `balancia_database_query_duration_seconds`                                                                       | histogram | —                                                          |
| `balancia_database_pool_connections`                                                                             | gauge     | `state` (`total`/`idle`/`waiting`)                         |
| `balancia_build_info`                                                                                            | gauge     | `version`                                                  |
| `process_resident_memory_bytes`, `nodejs_heap_used_bytes`, `process_cpu_seconds_total`, `process_uptime_seconds` | gauge     | —                                                          |

Recurring-expense failures, Splitwise import duration and failures, and
notification delivery are covered by the job metrics: the queue label
distinguishes `recurring.generate`, `import.commit`, `notifications.deliver`
and the rest.

**Receipt OCR has no server-side duration metric, and cannot have one.**
Recognition runs in the browser against models this instance serves; the server
never sees the image, the text or the time it took. The product counter
`receipt_ocr_used` records that a scan happened and how it ended, and that is
the only thing the server can honestly know.

Two rules keep this endpoint from becoming the leak that telemetry is not:

1. **Every label value is a literal from the source** — a route _template_
   (`/api/groups/[groupId]/export`), a queue name, an outcome. Never
   `request.url`, which carries group and attachment identifiers.
2. **The database histogram has no statement label.** Timing is wrapped around
   the connection pool rather than hooked into Drizzle's logger, because that
   hook is handed the SQL _and its parameters_ — amounts, descriptions,
   addresses. What is recorded is a duration and nothing else.

Protect it: the app's port is published by `compose.yaml`, so set
`METRICS_TOKEN` unless that port is on a private network. Requests without a
matching `Authorization: Bearer` are refused when the token is set; with
metrics off, the route answers 404.

`scripts/bootstrap.sh` asks about this one too, defaulting to no, and generates
a token when the answer is yes. Because `METRICS_ENABLED` is more often set by
hand afterwards than answered in the wizard, a re-run also checks for the
combination the schema has to allow but rarely means — metrics on, token empty
— and offers to generate one. Declining is a valid answer, and the only one
that is right when the port is on a private network.

Balancia does not ship an OpenTelemetry exporter. An operator who runs a
collector can scrape this endpoint, or add an exporter in a fork — but nothing
in a default installation talks to an observability backend, and adding an SDK
that could would have made this document's first paragraph harder to say.

---

## 12. Network endpoints

An opted-in instance makes exactly these requests, and no others:

| When                                             | Request                                         |
| ------------------------------------------------ | ----------------------------------------------- |
| Weekly, if usage statistics are on               | `POST https://telemetry.balancia.app/v1/report` |
| On an error, if crash reports are on, throttled  | `POST https://telemetry.balancia.app/v1/crash`  |
| When an administrator presses "send test report" | `POST https://telemetry.balancia.app/v1/report` |

One host, compiled in, no setting that changes it — so this table is the whole
of what an opted-in instance can reach, and it stays true without a caveat.

`Content-Type: application/json`. Five-second timeout. **No retries** — a
failed weekly report is simply not sent, and the next one is a week away; a
retry loop across thousands of installations is a way to build an accidental
denial of service against one's own collector. Redirects are refused rather
than followed, so a collector cannot bounce an instance at an address it never
agreed to talk to. No cookies, no credentials, no authorization header, and a
fixed `User-Agent: Balancia` that says nothing the payload does not.

### The receiving side

The collector is this same application with `TELEMETRY_RECEIVER=true`, which is
what makes it inspectable, and what lets a fork run its own without writing a
server. It exposes:

```
POST /v1/report   → /api/telemetry/v1/report
POST /v1/crash    → /api/telemetry/v1/crash
```

- **No authentication.** A report carries no identity by design, so there is no
  account to attach a credential to, and a shared secret compiled into every
  copy of an open-source application is not a credential.
- **8 KiB maximum payload**, checked against `Content-Length` before the body is
  read and against the actual bytes afterwards.
- **Strict schema validation.** Unknown properties are **rejected with 400**,
  not discarded — see §13.
- **Rate limited** to 60 reports per hour per source.
- **202 Accepted** on success, with no body worth parsing.

---

## 13. Schema versioning and the unknown-property policy

Every payload carries `"schema": 1`.

**Unknown properties are rejected, not ignored.** A field nobody agreed to send
is a bug at one end or the other, and accepting it quietly would turn §3 from a
fact into a claim. The response is `400` with `{"error":"invalid-payload"}`.

**Unknown schema versions are refused clearly**, with `422` and
`{"error":"unknown-schema"}`, rather than as a field-by-field validation
failure — a newer installation talking to an older collector should get an
answer it can be understood from.

Evolving the schema:

- _Adding a field_ is a new schema version. The collector may accept several
  versions at once; the sender always sends one. Old installations keep sending
  the version they know, and are neither broken nor upgraded by the collector.
- _Removing or renaming_ is likewise a version bump.
- The version is checked **before** the body is validated, so version
  negotiation never depends on the shape of a payload the collector may not
  understand.

Old installations therefore keep working indefinitely without change, which
matters more here than usual: a self-hosted instance may go years between
upgrades, and telemetry must never be the reason one starts failing.

---

## 14. Forks: replacing, redirecting or removing telemetry

Balancia is AGPL-3.0-or-later, and this was built to be easy to change.

**Redirect it** — one line, in `src/lib/telemetry/endpoint.ts`:

```ts
export const TELEMETRY_ENDPOINT = "https://telemetry.example.org";
```

Deliberately a constant rather than a setting. A fork is building from source
anyway, so nothing is lost by refusing to make it a runtime option — and what
is gained is that the upstream promises above hold without "…unless somebody
changed it" attached to each one.

**Collect it yourself** — run a Balancia instance with `TELEMETRY_RECEIVER=true`
and point that constant at it. The collector is the same image.

**Disable it for every installation of your fork** — ship
`TELEMETRY_MODE=off`, or change the default in `src/lib/env.ts`. One line, and
`NullTelemetryProvider` is what runs everywhere.

**Replace the transport** — `src/lib/telemetry/providers.ts` holds three
classes behind one interface, and `providerFor()` picks between them. A fork
that wants a different destination, format or cadence writes a fourth and
returns it there. Nothing in `src/modules` knows which provider is running.

**Remove it entirely** — delete `src/lib/telemetry`, the calls to `telemetry.*`
in the domain services (each is one `await` after a commit, never inside a
transaction), `src/modules/telemetry`, the administration page, the two
collector routes and the two queue entries. Nothing else depends on it: no
domain type mentions it, no query joins to it, and every call site is
fire-and-forget.

What is _not_ recommended is quietly changing what is collected while keeping
the copy that says none of it is. The privacy claims in this document and in
the UI are load-bearing.

---

## 15. Privacy and security design decisions

**Typed events, never objects.** The public API is one named function per
event, each taking literal-typed fields:

```ts
telemetry.expenseCreated({
  splitMethod: "percentage",
  direction: "out",
  multiCurrency: true,
  hasReceipt: false,
  participantCount: 4,
});
```

There is deliberately no `track(name, payload)`. `telemetry.expenseCreated(expense)`
does not compile, because an `Expense` is not assignable to any parameter — so
the mistake that leaks financial data is a type error at the call site rather
than a review comment somebody has to remember to write.

**The pipeline is one-way, with checks at each hand-off:**

```
domain event → explicit mapper → counter keys → local aggregation
             → report builder → schema validation → content guard → transport
```

**A content guard that does not know the schema.** Before anything is sent,
`src/lib/telemetry/guard.ts` walks the payload and refuses it if any key or
string looks like an address, a URL, a credential, a UUID, a long number, a
path, or simply anything longer than 64 characters. The schema is what a future
change edits; this is what that change still has to get past. A trip drops the
payload and logs the rule — never the value.

**Buckets everywhere, coarser where it matters.** Activity counts use a
ten-step ladder; installation _sizes_ use a shorter one that ends at `100+`,
because a user count barely moves and would otherwise be near-stable
identifying material in every weekly report.

**Aggregate, don't stream.** Events become numbers locally. One request a week
leaves the instance. Nothing is sent per action, which means the collector
cannot see the shape of a day's activity even in aggregate — and an instance
that is switched off for six days sends the same report as one that was busy on
Tuesday.

**Bounded traffic.** No retries. One weekly report, enforced by a six-day floor
so a retried job or a second scheduler cannot double it. Crash reports throttled
per class and per day.

**No endpoint in the UI.** Deliberate, and worth being explicit about: a
configurable endpoint in an administration form is server-side request forgery
with extra steps. The setting lives where only the operator can reach it.

**Known limitations, stated rather than glossed:**

- _Fingerprinting._ A report carries no identifier, but the combination of
  version, architecture, deployment kind, feature flags and size buckets is not
  unique-free in principle — an unusual combination could be rare. The
  mitigations are that everything is bucketed, that sizes are bucketed coarsely,
  that the cadence is weekly, and that nothing durable ties two reports
  together. It is a real residual risk and it is the reason §16 exists.
- _IP addresses at the network layer._ See §16.
- _`AUTH_SECRET` and the collector's rate limiter._ See §16.

---

## 16. No installation identifier, and what that costs

There is no `installation_id`, `instance_id`, `machine_id`, hostname, domain or
URL in any payload, and no column for one in either the sender's or the
collector's schema. Two reports from the same instance are indistinguishable
from two reports from different instances.

**This was chosen knowing what it costs.** Without a stable identifier the
project cannot measure retention, cannot say how many distinct installations
exist, cannot separate "one busy instance" from "ten quiet ones", and cannot
tell an upgrade from a new install. Those are genuinely useful things to know,
and they are given up on purpose: an identifier that persists across reports is
the difference between statistics and a record of a particular server, and
every system that has one eventually finds a reason to join something to it.

If a future version needs installation-level analytics, that is a change to
this document and to the consent copy first, and to the code second.

### IP addresses

**On the wire, unavoidably.** An HTTP request has a source address. The
collector does not read it, does not log it and does not store it as analytics
data — but it exists in transit, and pretending otherwise would be the kind of
claim this document is written to avoid.

**In access logs, which is infrastructure, not application.** Balancia's own
logs (pino) never record a client address for these routes. If a reverse proxy,
CDN or platform sits in front of a collector, _that_ will write access logs
containing source addresses unless configured not to. Anyone operating a
collector should disable access logging for the telemetry paths. For nginx:

```nginx
location /v1/ {
    access_log off;
    proxy_pass http://balancia:3000/api/telemetry/v1/;
}
```

Caddy:

```
handle /v1/* {
    log_skip
    reverse_proxy balancia:3000
}
```

The self-hosted side has nothing to configure: a sending instance makes an
outbound request and receives nothing to log.

**In the collector's rate limiter, pseudonymously and briefly.** Refusing a
flood requires distinguishing one source from another. What is stored is an
HMAC of the address under the collector's own `AUTH_SECRET`, salted with the
UTC day, in the `rate_limits` table, swept within 24 hours by the maintenance
job — never joined to a report, and never seen by the analytics tables.

That is a pseudonym, not anonymity: somebody holding both a database dump and
`AUTH_SECRET` could confirm a _guessed_ address by recomputing the hash, and
could enumerate IPv4 space to recover one. The alternatives were a single global
limit — which would let one abuser deny service to everyone — or no limit at
all. The trade is stated here rather than smoothed over.

---

## 17. Page counts on the public pages

Alongside the weekly report, an opted-in instance counts views of its four
public pages with [Umami](https://umami.is) at the same address.

### One consent, not two

There is no second switch and no setting of its own. Whatever decides the
weekly report decides this too — the administrator's telemetry switch, and
`TELEMETRY_DEFAULT` for where it starts (§2):

| Telemetry              | Weekly report | Public-page counts |
| ---------------------- | ------------- | ------------------ |
| Off — the default      | no            | **no**             |
| `TELEMETRY_MODE=local` | no            | **no**             |
| Switched on            | yes           | yes                |

`local` mode gets its own row because it is the interesting one: the promise
there is that nothing leaves the server, so a tracker that phoned home would
break it. The gate is therefore _transmitting_, not _recording_ — the same
question the weekly report asks before it sends.

With telemetry off, no script tag is rendered, no request is made, and there is
nothing for a reader to opt out of. That is every self-hosted installation that
has not asked for otherwise — either an administrator moving the switch, or the
deployment answering yes to the wizard's telemetry question.

### Where the counts go

`https://telemetry.balancia.app/script.js`, compiled into
`src/lib/analytics/umami.ts`. Not a setting, for the reason the report's
endpoint is not one (§8): an address that can be set is a lever, and it would
make every statement here conditional on nobody having changed it. Because it
is the same host the weekly report already uses, the network-level check stays
one hostname —

> blocking that one host is enough to be certain about everything Balancia
> would send, page counts included.

The website ID sits on the next line — `022fe040-…`, which is not a secret:
Umami puts it in a `data-website-id` attribute, so it is in the page source of
every page that loads the tracker. It identifies a dashboard, not a visitor. A
fork replaces both lines, or deletes the ID, which leaves a build that renders
no tag and widens no policy.

### Where the tracker runs

| Page             | Tracker              |
| ---------------- | -------------------- |
| `/`              | when telemetry is on |
| `/sign-in`       | when telemetry is on |
| `/register`      | when telemetry is on |
| `/register/done` | when telemetry is on |
| Everything else  | **never**            |

The boundary is not a setting either. Balancia's URLs name groups and expenses
— `/groups/{groupId}/expenses/{expenseId}` — and a page view carries the URL.
There is no configuration of Umami, or of any analytics product, that makes
that safe to send anywhere. So the tracker is not on those pages, and
`src/components/analytics/umami-script.test.tsx` fails the build if the
component is imported anywhere but the landing page and the auth layout.

Two attributes on the tag are load-bearing rather than decorative:

- **`data-exclude-search`** — two of the four public pages carry a group ID in
  the query string: `/sign-in?next=/groups/{id}`, written by
  `groups/[groupId]/layout.tsx` when a signed-out reader opens a group link,
  and `/register/done?group={id}` after registration. Without this the tracker
  would report the whole query.
- **`data-do-not-track`** — honours the browser's signal, at the cost of
  accuracy on a number nothing depends on.

The script tag carries the request nonce, because `'strict-dynamic'` in the CSP
means host allowlists in `script-src` are ignored entirely. The only directive
that changes is `connect-src`, and the host it gains is derived from the script
URL rather than stated separately, so the address the tracker posts to and the
address the policy admits cannot disagree. That directive is present on any
build carrying a website ID, whether or not telemetry is on — a permission is
not a request, and `proxy.ts` runs on every request and must not read the
database to decide a header.

### What this costs, said plainly

This is the one thing an opted-in instance sends that is **not** covered by the
guarantees in §16. The weekly report has no identifier of any kind; Umami
derives a visitor ID by hashing the IP address together with the user agent and
a rotating salt. No cookie is set and no IP is stored, but that hash is a
pseudonym lasting about a day.

It is a defensible trade for four pages that contain no expenses, no groups and
no accounts, and it would not be defensible one page further in — which is
exactly why the table above stops where it does. An administrator who wants the
weekly report but not this should say so; there is currently one switch, and
splitting it is the obvious next change if anyone asks.

The landing page says which of the two states it is in, in its own copy, rather
than leaving a reader to check the network tab.

---

## Where the code lives

| Path                             | What it is                                                |
| -------------------------------- | --------------------------------------------------------- |
| `src/lib/telemetry/events.ts`    | The complete event vocabulary, as literal types           |
| `src/lib/telemetry/index.ts`     | The typed API the domain calls                            |
| `src/lib/telemetry/buckets.ts`   | The bucket ladders                                        |
| `src/lib/telemetry/schema.ts`    | The wire contract, shared by sender and collector         |
| `src/lib/telemetry/guard.ts`     | The content scan that does not know the schema            |
| `src/lib/telemetry/providers.ts` | Null / Local / Balancia                                   |
| `src/lib/telemetry/report.ts`    | The one serializer, used by the preview and the transport |
| `src/lib/telemetry/crash.ts`     | Error → class name                                        |
| `src/lib/telemetry/transport.ts` | The outbound request                                      |
| `src/lib/telemetry/receiver.ts`  | The collecting side                                       |
| `src/lib/telemetry/settings.ts`  | Deployment ceiling × administrator switch                 |
| `src/lib/metrics/`               | Local Prometheus metrics — unrelated to the above         |
| `src/lib/analytics/umami.ts`     | Public-page counts, gated on the same opt-in (§17)        |
| `src/app/settings/admin/`        | The administration screen                                 |
