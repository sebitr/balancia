# Be findable in French, compared with Splitwise and tricount on the site, and stop the page counter following people into the app

Branch: `feat/seo-geo-acquisition`

The public pages get an address per language (`/fr`), two comparison pages in
each, a generated `/llms.txt`, and a `<head>` that says all of it. The page
counter learns which link and which button a sign-up came through — and is
stopped from reporting signed-in screens, which it had been doing since it
shipped. `docs/seo.md`, `docs/analytics.md` and `docs/telemetry.md` §17.

Not in the code, and still to do by hand: purge the signed-in paths already
in the collector, submit the sitemap to Search Console and Bing, and check the
CDN is not blocking the assistants' crawlers — `docs/seo.md` §6.
