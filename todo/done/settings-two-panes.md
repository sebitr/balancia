# Keep the settings list open beside the setting you are changing, on a desktop

Merged: 2026-10-06 in #444

Design: https://claude.ai/artifact/Nwc4hfpwGTdcHj4e7suBHQ (board "18 · Settings")

From `lg` (1024px) up, settings is two panes inside the same surface: the hub's
rows down the left, each with its value, and the chosen screen on the right,
with the ✕ drawn once along the top and still closing back to wherever settings
was opened from. `/settings` opens on the account screen. Below `lg` the hub and
its screens are separate pages exactly as before. The surface is
`src/app/settings/layout.tsx`; package 10 of the desktop experience.
