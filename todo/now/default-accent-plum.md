# Plum is the default accent, so the button no longer looks like the debt above it

Branch: `feat/default-accent-plum`

Design: https://claude.ai/artifact/7XLCemkukMgsk3dhKBmhB7

New accounts and signed-out screens get plum. Accounts made before keep coral:
they stored "never chose" and "chose coral" as the same null, so the column's
null keeps meaning coral (`UNCHOSEN_ACCOUNT_ACCENT`), and from here on every
choice is stored by name. Moving those accounts to plum would take a migration
that decides for them; that is the owner's call, not this branch's.
