# Use the whole window on a desktop, instead of a phone column with a bottom bar

Branch: `feat/desktop-layout`

Design: https://claude.ai/artifact/47LVzp9wBfizx7zgqDoFYw

From `lg` (1024px) up, a group's bottom bar becomes a left rail that also
carries the group switcher, the bell and the account; the overview reads in two
columns; every bottom sheet is held to a 28rem column from `md` up. Below `lg`
nothing moves. The shell is `src/components/layout/app-shell.tsx`.
