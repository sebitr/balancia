# Balancia design system

Preview pages that document Balancia's visual language, synced to the
**Balancia Design System** project on [claude.ai/design](https://claude.ai/design).

The app is the source of truth. These pages are a transcription of
`src/app/globals.css` (tokens) and `src/components/ui/*` (primitives), plus the
domain patterns that only exist in Balancia. When the app changes, change these
too — a design system that has drifted from the code is worse than none.

## Layout

```
design-system/
  build.mjs          composes dist/ from src/
  src/kit.css        every token and component recipe, shared by all pages
  src/pages/         body fragments, one per card
  dist/              generated standalone pages — this is what gets uploaded
```

Each page in `dist/` stands alone: `kit.css` is inlined and the only external
requests are Instrument Sans and Instrument Serif from Google Fonts. The Design
System pane renders each page in isolation, so nothing may reference a sibling
file. The app self-hosts the same faces through `next/font` — these pages link
out only because the pane has no bundler.

## Building

```bash
pnpm design-system
```

Every fragment's first line must be an `@dsCard` marker — that is what the
Design System pane indexes to build its card list:

```html
<!-- @dsCard group="Components" name="Button" subtitle="Six variants, nine sizes" -->
```

`group` becomes the section heading in the pane, `name` becomes the card title
and the page `<title>`. The build fails if either is missing.

## Syncing

Ask Claude Code to push changes; it uses the `DesignSync` tool against project
`bc40be52-3594-4922-8990-c002d21bbf14`. Sync one component at a time rather than
replacing the project wholesale — the remote copy may carry edits made in the
Design pane that aren't here yet, so read before you overwrite.
