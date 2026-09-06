# Give every list item its own file, so two branches never edit the same lines and GitHub stops flagging a conflict git resolves on its own

Branch: `chore/todo-per-item`

The union driver in `.gitattributes` fixed the merge but could not reach
GitHub's mergeability check, so every pull request still showed "This branch has
conflicts that must be resolved" the moment another branch touched the list —
and not once, but again every time main moved while the pull request stayed
open. One file per item makes the anchor per-item: two branches touching
different items have nothing in common to conflict over, and moving an item
between states is a rename, which git merges cleanly against a branch that only
edited the file's contents.
