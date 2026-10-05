# Measuring acquisition

What Balancia's own site measures about the people who find it, which number
each measurement is in service of, and where to read them. It is the plan the
goals, funnels and segments in the project's Umami were built from, written
down so that the next report added there has something to be checked against.

This is about the project's site, `balancia.app`. A self-hosted instance
measures none of it unless its administrator switches telemetry on, and
[telemetry.md §17](telemetry.md#17-page-counts-on-the-public-pages) is the
contract for exactly what is then sent. Nothing here widens that contract;
this document is about reading what it already allows.

---

## 1. The one number

**Accounts created by people who found Balancia on their own**, per week.

Not visitors, not page views. A visitor who reads the homepage and leaves has
told the project nothing it can act on; an account is somebody who decided.
It is the `signup-completed` event: a reader who arrived at `/register` with no
invitation and came out of the credential screen with an account.

Two neighbours are counted beside it, because they are the same decision made
a different way:

- **`guest-group-started`** — the same arrival chose no account, named a group
  and left with its link. A group exists that did not.
- **`install-copied`** — the install commands were copied. Somebody is about
  to run their own instance, and will never appear in the first number.

Everything else below exists to explain movement in these three.

### What this number cannot see

It stops at the door. Whether the new account went on to create a group, add
an expense or come back next week is inside the application, and the tracker
is never there — not by setting but by construction; see the telemetry
contract. Those questions have other answers:

| Question                                    | Where the answer is                                                        |
| ------------------------------------------- | -------------------------------------------------------------------------- |
| How far through sign-up did people get?     | `balancia_onboarding_steps_total`, on the instance's own `/api/metrics`    |
| Which sign-up method was used, and refused? | `balancia_server_action_total`, same place                                 |
| Are groups and expenses being created?      | The weekly usage report's buckets; the administration screen previews them |
| Did the people who were invited join?       | `guestsJoined` and `invitesCreated` in the same report                     |

They are aggregates with no identifier in them, which is the price of the
promise and is paid on purpose. There is no way to follow one visitor from a
search result to their tenth expense, and nothing here should try.

---

## 2. The funnel

```
found it  →  read a public page  →  opened /register  →  has an account
(source)     (page view)             (page view)          (signup-completed)
```

Each arrow is a rate, and each rate has a different owner:

| Step                      | Measured by                            | Moved by                                                                   |
| ------------------------- | -------------------------------------- | -------------------------------------------------------------------------- |
| Found it                  | Visitors, by source                    | Being listed, linked and cited — [seo.md §6](seo.md#6-what-no-code-can-do) |
| Read → opened `/register` | `signup` clicks ÷ visitors, by page    | The page: its copy, its first screen, its buttons                          |
| Opened → has an account   | `signup-completed` ÷ `/register` views | The sign-up flow itself                                                    |

Read them in that order when the one number moves. A week with fewer accounts
and the same two rates is a traffic week; the same traffic and a worse second
rate is something that changed on a page.

---

## 3. What is counted

The complete list is in
[telemetry.md §17](telemetry.md#which-buttons-are-counted), and
`src/lib/analytics/events.ts` is where an event has to be added before it can
be sent at all. Grouped by the question each answers:

| Question                                   | Events                                                      |
| ------------------------------------------ | ----------------------------------------------------------- |
| Did they decide?                           | `signup-completed`, `guest-group-started`, `install-copied` |
| Which button started it?                   | `signup`, by `at`                                           |
| Where did the ones who did not sign up go? | `source`, `demo`, `self-hosting-guide`, `sign-in`           |
| What were they unsure about?               | `faq`, by `question`                                        |
| Did the comparison pages get read?         | `comparison`, by `with` and `at`; page views of the pages   |
| Did the language matter?                   | `language`, by `to`; page views under `/fr`                 |

Two rules for adding to it:

- **An event has to answer a question somebody will act on.** "How far did
  they scroll" is not one. If nothing would be changed by the answer, the
  event is noise in every report it appears in.
- **Every value is a literal in the source.** A place on the page, a
  question's key, a language code. The types refuse anything else, and that
  refusal is the reason an administrator can be shown the whole list.

---

## 4. Where they came from

A page view carries its referrer and, when the link had one, a campaign label.

### Sources, as Umami groups them

| Segment                            | What it catches                                                                 |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| _From a search engine_             | Google, Bing, DuckDuckGo, Ecosia, Qwant, Brave, Startpage, Kagi, Yandex         |
| _From an AI assistant_             | ChatGPT, Perplexity, Claude, Gemini, Copilot, Mistral — by referrer or by label |
| _From GitHub_                      | The repository, its README, its issues                                          |
| _From communities and directories_ | Reddit, Hacker News, Lobsters, selfh.st, AlternativeTo, Framalibre              |
| _Tagged links_                     | Anything carrying a `utm_source`                                                |

An assistant's citation arrives one of two ways: a referrer, when the answer
was read in a browser, or `utm_source=chatgpt.com` on the link, which is often
all there is when it was read in an app. The segment matches either.

"Direct" is the remainder and is mostly not people typing the address. It is
every app that sends no referrer — a chat message, a mail client, a PDF — and
most crawlers. Do not read a rise in it as word of mouth.

### Labelling a link you control

```
https://balancia.app/?utm_source=awesome-selfhosted&utm_medium=directory
```

| Parameter      | Use                                  | Examples                                                   |
| -------------- | ------------------------------------ | ---------------------------------------------------------- |
| `utm_source`   | Where the link is                    | `awesome-selfhosted`, `reddit`, `hackernews`, `newsletter` |
| `utm_medium`   | What kind of place that is           | `directory`, `community`, `social`, `email`, `docs`        |
| `utm_campaign` | The occasion, when there is one      | `launch-1-9`, `splitwise-import`                           |
| `utm_content`  | Which of two links in the same place | `readme-top`, `readme-footer`                              |

Lower case, hyphens, no spaces. A value is sent only if it is a label — at
most 64 characters of `a–z`, `0–9`, `.`, `_`, `-` — and anything else is
dropped rather than cleaned up, so a mistyped one vanishes instead of becoming
a row. Pick the source's name once and keep it: `hackernews` and `hn` are two
sources to a report.

Do not label the links in the repository's own README to the site. GitHub
sends a referrer, and a label there would move those visits out of _From
GitHub_ and into a segment of their own for no gain.

---

## 5. What is set up in Umami

Under the Balancia website at `telemetry.balancia.app`. All of it is
configuration there, not code here, and none of it changes what is collected.

### Goals

| Goal                             | Is                          |
| -------------------------------- | --------------------------- |
| Account created                  | event `signup-completed`    |
| Reached sign-up                  | page `/register`            |
| Pressed Create account           | event `signup`              |
| Group started without an account | event `guest-group-started` |
| Copied the install commands      | event `install-copied`      |
| Opened the self-hosting guide    | event `self-hosting-guide`  |
| Went to the source               | event `source`              |
| Tried the demo                   | event `demo`                |

### Funnels

Each within an hour, ending at `signup-completed` unless it says otherwise.

| Funnel                          | Steps                                            |
| ------------------------------- | ------------------------------------------------ |
| Homepage to account (English)   | `/` → `/register` → account                      |
| Homepage to account (French)    | `/fr` → `/register` → account                    |
| Splitwise comparison to account | `/splitwise-alternative` → `/register` → account |
| tricount comparison to account  | `/tricount-alternative` → `/register` → account  |
| Any comparison page to account  | `*alternative*` → `/register` → account          |
| Homepage to self-hosting        | `/` → `install-copied`                           |

### Segments

The five in §4, plus _Comparison pages_ (path contains `alternative`) and
_French pages_ (path under `/fr`). A segment is a filter that can be laid over
any report: the funnel above under _From an AI assistant_ is the answer to
whether being written for assistants is producing accounts.

### Built in, and worth opening

- **UTM** — every labelled link, by source, medium and campaign.
- **Attribution** — which source the people who reached a goal first came
  from. Set the conversion to the event `signup-completed`.
- **Performance** — the browser's own load timings per page. A public page
  whose largest paint is over 2.5 seconds, or whose layout shifts as it loads,
  is being marked down by the same search engines the page was written for.
- **Journeys** — the paths people actually take between the public pages,
  which is where a step nobody designed shows up.

---

## 6. Reading it

**Weekly, ten minutes.** The three numbers from §1, against the week before.
If one moved, the two rates from §2 say which arrow, and the sources report
says whether it was one referrer.

**Monthly.** The funnels, per segment. Search Console and Bing Webmaster
Tools beside them: impressions and position for the comparison pages are the
leading indicator, weeks ahead of any visit. The `faq` events: a question
opened by a third of readers is a question the page above it failed to
answer.

**Quarterly.** Re-read the two competitors' own pages and move the comparison
date ([seo.md §2](seo.md#the-date-is-a-fact-not-a-decoration)). Ask an
assistant the questions the pages were written for — "open-source Splitwise
alternative", "alternative à Tricount gratuite" — and note whether Balancia is
named and what is cited for it. There is no tool that reports this honestly;
asking is the measurement.

### What the numbers will not bear

The site has on the order of a hundred and fifty visitors a quarter. At that
size:

- **A rate is an anecdote.** Three sign-ups from forty visitors and one from
  thirty-five are the same result. Read counts, not percentages, until a
  funnel's first step is in the hundreds.
- **Do not A/B test.** There is not the traffic to tell two versions of a
  heading apart in a year. Change the page on judgement, write down the date,
  and compare the month after with the month before.
- **A crawler is a visitor.** Most that run scripts are filtered; some are
  not. A day with thirty visits from one country and no second page view is
  one.

---

## 7. What is deliberately not measured

- **Anything inside the application.** Not page views, not clicks, not
  errors. The hook that guards the tracker sends nothing from an address that
  is not on its list, and the list is the public pages.
- **Who a visitor is.** No cookie, no identifier, no way to recognise a
  returning reader beyond Umami's daily hash. "Returning visitors" is
  therefore not a number Balancia has, and retention is read from the weekly
  report's aggregates or not at all.
- **Recordings and heatmaps.** Umami offers both. Neither is switched on and
  neither should be: a recording of a sign-up screen is a recording of an
  email address being typed.
- **Revenue.** There is none to measure.
