# Never show the last account's groups after signing out, and make the desktop keys do only what they say

Branch: `fix/desktop-signout-and-keys`

Confirmed desktop defects from the audit of 2026-11-24. The sidebar's list of
groups outlived a sign-out and was drawn — in the sidebar, the ⌘K palette and
"Add to which group?" — under the next account to sign in on the browser. ⌘↵
in "Delete this entry?" saved the edit instead of answering the question. A
click beside the desktop entry dialog dropped an edit or a half-typed
repayment. AltGr typing `\` on Windows folded the sidebar. The palette and the
group chooser acted on Enter and the arrows in the middle of an IME
composition. Plus three duplicated primitives folded into one each.
