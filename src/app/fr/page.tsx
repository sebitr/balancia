// The homepage in French: the same page as `/`, and the same file. What makes
// it French is the request header `proxy.ts` sets from the address, which the
// root layout reads too.
//
// A folder per language rather than one `[locale]` route, though that would
// have served every language from two files. A dynamic segment directly
// under `app/` answers every one-segment path nothing else claims — so
// `/dashbaord` and a scanner's `/wp-login.php` would be this page's to turn
// away, and the linter, reading it the same way, takes every deliberate
// `<a href="/dashboard">` in the error screens for a link to it.
// `lib/public-pages.test.ts` fails on a language that has no folder.
export { default, generateMetadata } from "../page";
