# Being found

How somebody who has never heard of Balancia comes to hear of it: from a search
engine, or from an assistant asked "what can I use instead of Splitwise that I
can host myself". This is what the application does about both, what it
measures, and the part no code can do.

Everything here is about a handful of pages. The rest of Balancia is somebody's
account, sits behind a session or an invitation, and is kept out of every index
— that half is unchanged and is not what this document is about.

---

## 1. The public pages

| Page                  | English                  | French                      |
| --------------------- | ------------------------ | --------------------------- |
| Homepage              | `/`                      | `/fr`                       |
| Balancia vs Splitwise | `/splitwise-alternative` | `/fr/alternative-splitwise` |
| Balancia vs tricount  | `/tricount-alternative`  | `/fr/alternative-tricount`  |

One table in the source says what they are: `src/lib/public-pages.ts`. The
proxy, the `<link rel="alternate">` tags, the sitemap, `/llms.txt` and the test
that decides where the page counter may be mounted all read it, so adding a row
is the whole of making a page public — and the reason the list above cannot
quietly disagree with the code.

### The address is the language

Inside the application a reader's language comes from their cookie, then their
browser. That is right for a private screen and wrong for a public one: a
crawler sends neither, so while the homepage chose its language that way it was
only ever read in English, and the French copy — written for French searches,
with its own questions — was in no index at all.

So a public page has one address per language, and the address decides. `/fr`
is French to everybody. `proxy.ts` reads the language off the path and hands it
to the render in a request header, which the root layout reads too — that is
where `<html lang>` is written. English has no prefix: it is the language those
addresses were already indexed in.

English pages are a folder each under `src/app`, named after the page. Every
other language is a folder named after itself — `src/app/fr/` — holding two
small files: its homepage, which re-exports the English one, and a `[slug]`
route that looks the address up in the table and renders the same component.

They are routes rather than a rewrite to the English file, which is the
obvious way to serve one file at two addresses and was the first one tried.
Next runs the proxy a second time on the path a rewrite points at: `/fr`,
rewritten to `/`, came back through as `/`, was told it was English, and was
rendered in English at a French address.

Two things follow from "one address, one page":

- **A spelling that names a page but is not its address redirects**, with a 308. `/en` goes to `/`, and `/fr/splitwise-alternative` — a French page
  under its English slug — goes to `/fr/alternative-splitwise`. Nothing is
  ever readable at two URLs.
- **`/` sends a reader on, once.** Somebody whose cookie or browser asks for
  French and who opens `/` is redirected to `/fr`. It is the one address that
  does this, because it is the one people type; a crawler states no preference
  and reads English there. Choosing a language from the menu writes the cookie
  first, so choosing English from `/fr` is not undone by the page it leads to.

A language Balancia gains later needs its folder — two files, copied from
`src/app/fr/` with the code changed — and nothing else.
`src/lib/public-pages.test.ts` fails, naming the files, until they exist. Its
pages are then at `/<code>/<english-slug>`, and move to words of their own
when somebody adds them to `SLUGS`, at which point the old address redirects.

### What each page says about itself

`src/components/marketing/metadata.ts` writes the `<head>` for all of them, as a set:

- a **title** with the product's name in it and a **description** written for
  the result it will be shown in;
- a **canonical URL**, and an **alternate for every language** plus
  `x-default`, which is the English address;
- `index, follow` — the root layout says `noindex` for the whole application,
  and a public page has to say otherwise for itself;
- an Open Graph card, with the drawn one for English and the icon elsewhere,
  the drawn card having English words in it.

And structured data, as JSON-LD: the homepage describes the software, its
publisher and its questions; a comparison page describes itself, what it is
about, when it was last checked, where it sits and its questions. The
publisher's `sameAs` names the repository, which is most of how an engine
learns that the Balancia on this site and `sebitr/balancia` are one project.

**The homepage speaks for the instance it is served from.** Its section on AI
assistants, its question "Can I use Balancia with Claude, ChatGPT or another AI
assistant?" and the matching line in the structured data's feature list are
there only where `AGENT_ACCESS` is on. Where an administrator has switched it
off, `/mcp` answers 404, and a page that said yes would be a page that was
wrong about itself. `/llms.txt` and `/llms-full.txt` describe the software
rather than the instance and keep all of it.

---

## 2. The comparison pages

Somebody typing "Splitwise alternative" has already decided to leave something
and is choosing where to go. These pages are for them, and they are written to
be quoted:

- **The first paragraph answers the question on its own.** What Balancia is,
  what the other product is, and the difference, in three sentences.
- **Each row of the table is a whole sentence with the product's name in it**,
  so a row lifted out of the page — which is what an assistant does — still
  means what it meant in it.
- **The other product gets its reasons stated as plainly as Balancia's.** A
  comparison that only flatters its author is one nobody has a reason to
  believe, a ranking system included.
- **Every claim about the other product is one its own pages make**, linked at
  the foot of the page and dated.

The words are in `messages/*.json` under `compare`; `comparison-content.ts`
reads them into a structure once, and both the page and `/llms-full.txt` print
that structure. [compare-splitwise.md](compare-splitwise.md) and
[compare-tricount.md](compare-tricount.md) are the same comparisons in the
repository. A claim changes in both places or in neither.

### The date is a fact, not a decoration

`COMPARISON_REVIEWED` is the day somebody last read the other product's pages
and checked every row against them. It is printed on the page, sent as
`dateModified` and used as the pages' `lastmod` in the sitemap.

Move it only on a day you have done that. A date bumped to look fresh is a
false statement about a competitor's product with a timestamp on it — and the
next reader who checks will find the row that had gone stale.

---

## 3. What a crawler is told

| File             | What it is                                                                                              |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `/robots.txt`    | One group, for every crawler: the public pages are open, the application is not                         |
| `/sitemap.xml`   | Every public page once per language, each naming the others                                             |
| `/llms.txt`      | Balancia as a list of facts with links, for a language model                                            |
| `/llms-full.txt` | The same, with both comparisons and the homepage's questions written out, as one file of plain Markdown |

**The crawlers that feed assistants are welcome**, on exactly the pages a
search engine is — GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot and the
rest. Being read by them is how Balancia comes to be named in an answer.
`robots.txt` deliberately does not list them: a crawler that finds a group
addressed to it by name obeys that group and ignores `*`, so a list of names is
a second copy of the disallow list waiting to fall out of step.

`/llms.txt` was a static file and had gone stale the way one does — it
described a three-step install months after it became two, and said nothing
could be entered offline. It is generated now, from the install commands, the
page table and the comparisons the pages themselves use.

It also answers the question an assistant is now asked about Balancia itself —
"does it work with you?" — in a section of its own: the address to add
(`https://balancia.app/mcp`, or an instance's address followed by `/mcp`), the
steps for Claude, ChatGPT and Claude Code, and what a connection may and may not
do. The address is read from the constant the route is mounted at, so it cannot
drift from the code. [ai-agents.md](ai-agents.md) is the long form it links to.

---

## 4. On an instance that is not balancia.app

Every instance serves all of this, since its own footer links to it. Two
things differ:

- **The homepage is the instance's own.** Its canonical URL, its sitemap entry
  and its alternates all name the instance.
- **The comparison pages are filed under the project's site.** They say the
  same words on every instance, and so many copies of one page are so many
  competitors for it. Each names `https://balancia.app/…` as its canonical
  URL, and an instance leaves them out of its own sitemap.

`OFFICIAL_ORIGIN` in `src/lib/public-pages.ts` is that address, compiled in for
the reason the telemetry endpoint is. A fork edits the line.

An operator who wants none of it indexed needs no setting: put the instance
behind authentication at the proxy, or answer `X-Robots-Tag: noindex` there.

---

## 5. Measuring it

Counting is off unless an administrator has switched telemetry on, and
[telemetry.md §17](telemetry.md#17-page-counts-on-the-public-pages) is the
contract for what is sent. [analytics.md](analytics.md) is what to do with
it: the one number the public pages exist to move, the funnel behind it, how
to label a link, and the goals, funnels and segments set up in the project's
Umami.

The short of it: a page view carries its referrer and, when the link had one,
a campaign label; the page's own buttons are counted by name; and an account
coming into being at `/register` is counted once. An assistant's citation
shows up as a referrer of `chatgpt.com`, `perplexity.ai` and the like, or as
`utm_source=chatgpt.com` on the link — which is the reason campaign labels are
let through a query string that is otherwise dropped whole.

---

## 6. What no code can do

A page can be perfectly made and still unknown. These are the things that move
it, in the order they are worth doing, and every one is outside the repository:

1. **Tell the search engines.** Add the site to Google Search Console and Bing
   Webmaster Tools and submit `/sitemap.xml`. Bing matters more than its share
   suggests: its index is Copilot's own and among those ChatGPT's search
   draws on.
2. **Check the CDN is not turning the assistants away.** Cloudflare can block
   AI crawlers for a whole zone from one switch, and has made blocking the
   default choice for new zones. `robots.txt` cannot override it. In the
   dashboard: _Security → Bots_, and _AI Crawl Control_.
3. **Be where the question is asked.** An assistant answering "Splitwise
   alternative" quotes lists and threads far more than vendors' own pages. The
   ones that matter for this product: `awesome-selfhosted`, AlternativeTo
   (listed against both Splitwise and tricount), the `r/selfhosted` and
   `r/opensource` communities, selfh.st, and — for French — the equivalent
   Framalibre entry. Each is a link, and each is a sentence about Balancia in
   a place a model reads.
4. **List the connector where assistants look for connectors.** The hosted
   instance answers at `https://balancia.app/mcp`, which makes it something an
   assistant's directory can list. The official MCP Registry takes a
   `server.json` with a `remotes` entry of type `streamable-http` and is
   published to with `mcp-publisher`; a name under `io.github.sebitr/` is proved
   by signing in with GitHub, and one under the site's own domain by DNS or HTTP
   verification. The registry has been in preview and its format has changed
   before, so read the current publishing guide in `modelcontextprotocol/registry`
   rather than this paragraph; aggregators that copy from it pick a listing up
   by themselves. Claude and ChatGPT keep connector directories of their own,
   with their own submission rules; check them when you list. Only the
   hosted instance is worth listing: every self-hosted instance has an address
   of its own, which no directory can know.
5. **Keep the comparisons true.** Re-read the other products' pages every
   quarter, or when either changes its pricing, and move the date when you
   have.
6. **Write the next pages.** The table in §1 takes a row per page. What people
   search for next is a situation rather than a product — splitting rent with
   flatmates, a trip in two currencies, a couple on unequal incomes — and each
   of the homepage's six use cases is a page waiting to be written.

---

## Where the code lives

| Path                                             | What it is                                                    |
| ------------------------------------------------ | ------------------------------------------------------------- |
| `src/lib/public-pages.ts`                        | The pages, their addresses, and which origin each is filed at |
| `src/proxy.ts`                                   | Address → language header, and the redirects                  |
| `src/app/fr/`, `comparison-route.tsx`            | The routes a language other than English is served from       |
| `src/i18n/request.ts`                            | Where that header is read                                     |
| `src/components/marketing/metadata.ts`           | The `<head>` of a public page                                 |
| `src/components/marketing/shell.tsx`             | The header and footer every public page stands in             |
| `src/components/marketing/comparison-content.ts` | What the comparison pages say, as data, and the review date   |
| `src/components/marketing/comparison-page.tsx`   | The comparison page                                           |
| `src/app/robots.ts`, `src/app/sitemap.ts`        | The crawler files                                             |
| `src/components/marketing/llms.ts`               | `/llms.txt` and `/llms-full.txt`                              |
| `src/lib/analytics/`                             | What is counted — see [telemetry.md](telemetry.md)            |
