/**
 * The page a person is handed between saying yes and arriving back in the
 * assistant.
 *
 * The obvious answer to a form post is a `303` to wherever the application
 * asked to be sent, and it does not work. Balancia's Content-Security-Policy
 * says `form-action 'self'`, and Chromium applies that directive to the
 * *redirect* a form post is answered with: the server processes the form, issues
 * the code, and the browser then refuses to follow it to another origin — with
 * one line in the console and nothing on the screen. Every Chrome, Edge and Brave
 * user would have pressed Allow and watched nothing happen. A unit test of the
 * route cannot see it, because the route did everything right; it took a real
 * browser.
 *
 * Loosening `form-action` for this one path would mean putting a stranger's
 * redirect address into a security header. Answering with a page instead costs
 * nothing: a navigation that a page starts is not a form submission, so the
 * policy has nothing to say about it. The page refreshes itself onward at once
 * and carries a plain link for the browser that will not, and for the custom
 * scheme (`cursor://…`) that a browser asks the person to confirm anyway.
 *
 * It also keeps the code out of any address a person can bookmark or step back
 * to: a response to a POST is not something the back button re-requests.
 */

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function handoffPage(options: {
  /** Where the browser goes next: the application's address, with the answer on it. */
  readonly location: string;
  readonly language: string;
  readonly title: string;
  readonly hint: string;
  readonly continueLabel: string;
}): string {
  const location = escapeHtml(options.location);
  const title = escapeHtml(options.title);

  return `<!doctype html>
<html lang="${escapeHtml(options.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<meta name="robots" content="noindex">
<meta http-equiv="refresh" content="0;url=${location}">
<title>${title}</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;text-align:center;font:16px/1.5 system-ui,-apple-system,sans-serif}
main{max-width:22rem}
h1{margin:0 0 .5rem;font-size:1.125rem}
p{margin:0 0 1.25rem;font-size:.9rem;opacity:.7}
a{display:inline-block;padding:.7rem 1.4rem;border-radius:.75rem;background:#4b2e83;color:#fff;font-weight:600;text-decoration:none}
a:focus-visible{outline:3px solid #9b7fd1;outline-offset:2px}
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${escapeHtml(options.hint)}</p>
<a href="${location}">${escapeHtml(options.continueLabel)}</a>
</main>
</body>
</html>
`;
}
