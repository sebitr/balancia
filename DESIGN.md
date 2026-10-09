---
name: Balancia
description: A shared-expense tracker drawn as a plum-ink ledger on cream paper, built for a thumb at the table.
colors:
  aubergine-ink: "oklch(0.226 0.072 319)"
  cream-paper: "oklch(0.977 0.007 85)"
  white-card: "oklch(1 0 0)"
  linen-muted: "oklch(0.937 0.016 82)"
  lilac-secondary: "oklch(0.9 0.018 319)"
  lilac-secondary-ink: "oklch(0.33 0.088 319)"
  quiet-plum-text: "oklch(0.5 0.03 319)"
  hairline: "oklch(0.9 0.012 82)"
  field-line: "oklch(0.88 0.016 82)"
  plum-night-raised: "oklch(0.27 0.068 319)"
  midnight: "oklch(0.15 0.03 319)"
  midnight-raised: "oklch(0.2 0.035 319)"
  plum-accent: "oklch(0.71 0.048 319)"
  plum-accent-ink: "oklch(0.535 0.048 319)"
  plum-accent-ink-dark: "oklch(0.725 0.048 319)"
  accent-coral: "oklch(0.712 0.168 30)"
  accent-amber: "oklch(0.78 0.13 70)"
  accent-mint: "oklch(0.75 0.13 167)"
  accent-ocean: "oklch(0.71 0.12 235)"
  accent-lavender: "oklch(0.72 0.13 300)"
  accent-raspberry: "oklch(0.7 0.17 350)"
  settled-up-green: "oklch(0.654 0.13 167)"
  settled-up-green-ink: "oklch(0.496 0.13 167)"
  settled-up-green-dark: "oklch(0.75 0.13 167)"
  owed-red: "oklch(0.6 0.2 25)"
  owed-red-ink: "oklch(0.53 0.2 25)"
  owed-red-dark: "oklch(0.72 0.18 25)"
  owed-red-ink-dark: "oklch(0.735 0.162 25)"
  paid-by-amber: "oklch(0.72 0.145 70)"
  paid-by-amber-ink: "oklch(0.534 0.145 70)"
  paid-by-amber-dark: "oklch(0.82 0.14 78)"
  settled-grey: "oklch(0.62 0.035 319)"
  settled-grey-ink: "oklch(0.525 0.035 319)"
  settled-grey-dark: "oklch(0.7 0.03 319)"
typography:
  balance-hero:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.025em"
    fontFeature: "'tnum' 1, 'lnum' 1"
  headline:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 500
    lineHeight: 1.375
  body:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
  caption:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 400
    lineHeight: "1rem"
  label:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: "1rem"
    letterSpacing: "0.05em"
  micro:
    fontFamily: "Instrument Sans, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.6875rem"
    fontWeight: 500
    lineHeight: "1rem"
  identifier:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: "1.25rem"
rounded:
  sm: "0.45rem"
  md: "0.6rem"
  lg: "0.75rem"
  xl: "1.05rem"
  2xl: "1.35rem"
  3xl: "1.65rem"
  4xl: "1.95rem"
  full: "9999px"
spacing:
  row: "0.75rem"
  card: "1rem"
  gutter: "1rem"
  field-gap: "1.25rem"
  section: "1.5rem"
  tap-target: "44px"
  app-header: "4rem"
  sidebar: "15rem"
  sidebar-collapsed: "4rem"
  content-max: "75rem"
components:
  button-primary:
    backgroundColor: "{colors.plum-accent}"
    textColor: "{colors.aubergine-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "2.75rem"
    padding: "0 0.875rem"
  button-secondary:
    backgroundColor: "{colors.lilac-secondary}"
    textColor: "{colors.lilac-secondary-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "2.75rem"
    padding: "0 0.875rem"
  button-outline:
    backgroundColor: "{colors.cream-paper}"
    textColor: "{colors.aubergine-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "2.75rem"
    padding: "0 0.875rem"
  button-ghost:
    textColor: "{colors.aubergine-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "2.75rem"
    padding: "0 0.875rem"
  button-destructive:
    textColor: "{colors.owed-red-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "2.75rem"
    padding: "0 0.875rem"
  card:
    backgroundColor: "{colors.white-card}"
    textColor: "{colors.aubergine-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.xl}"
    padding: "1rem"
  input:
    textColor: "{colors.aubergine-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    height: "2rem"
    padding: "0.25rem 0.625rem"
  badge:
    backgroundColor: "{colors.plum-accent}"
    textColor: "{colors.aubergine-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.4xl}"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
  badge-secondary:
    backgroundColor: "{colors.lilac-secondary}"
    textColor: "{colors.lilac-secondary-ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.4xl}"
    height: "1.25rem"
    padding: "0.125rem 0.5rem"
  avatar:
    backgroundColor: "{colors.linen-muted}"
    textColor: "{colors.quiet-plum-text}"
    typography: "{typography.micro}"
    rounded: "{rounded.full}"
    size: "2rem"
---

# Design System: Balancia

## Overview

**Creative North Star: "The Kitchen-Table Ledger"**

Balancia looks like a page left on the table between friends: cream paper, plum ink, and one pen colour kept back for the next thing to do. It is where a bill gets settled, so it is warm and unhurried, and it is also a ledger, so every figure is exact, aligned and said in words. The reader is a group member on a phone, often standing, often mid-meal. The system is drawn for that hand first and then given modest room on a desk.

The personality is **warm and unhurried, plain-spoken, precise like a ledger, and quietly playful**. Warm is the cream ground, the soft 0.75rem corners and a plum that is a colour rather than a corporate navy. Plain-spoken is "you owe" and "gets back" in words rather than finance jargon. Precise is lining, tabular figures and a sign on every amount. Quietly playful is the mark splitting a bill on hover, and nothing that ever makes anyone wait to see a balance.

The system rejects four looks. It is not **banking or fintech software**: no navy-and-teal trust palettes, no charts-first density, no padlocks. It is not a **gamified money app**: no confetti, streaks or celebratory sums. It is not **generic SaaS gloss**: no gradient blobs, glass cards, stock illustrations or icon-in-a-circle grids. And it does not compete on **Splitwise's loud green**: here green means exactly one thing, that somebody owes you.

**Key Characteristics:**

- Plum ink on cream by day, cream on plum by night, with the accent held back for the next action.
- Three colours carry meaning (green, red, amber) and never move; the reader's accent never paints a money surface.
- Flat by default: a 1px hairline holds a surface, and a shadow means a thing genuinely floats.
- One Instrument Sans, seven type steps, tabular figures everywhere, and a phone scale one point larger than the desk's.
- Motion borrowed from iOS because the hand already knows it: pages travel, sections fade, drawers rise.
- Phone first. A desktop gets the same screens with the room used modestly.

## Colors

A cream-and-plum ground with one chosen accent and three fixed money colours. Every colour is authored in OKLCH in `src/app/globals.css`; the frontmatter is the normative copy of those values.

### Primary

- **Plum Accent** (`plum-accent`): the default accent and the one a reader who has never chosen sees, on every signed-out screen. It is `--primary` and `--ring`: the main button, the focus ring, the "you" pill, the "you" series in a chart, the selected tab. It is deliberately quiet (chroma 0.048) and sits beside neither money colour. Its text form is **Plum Accent Ink** (`plum-accent-ink`, 4.5:1 on cream; `plum-accent-ink-dark` on the dark card); a button label or a link is set in the ink, never in the fill.
- **Six other accents**, all chosen by name and stored by name: **Coral** (`accent-coral`), **Amber** (`accent-amber`), **Mint** (`accent-mint`), **Ocean** (`accent-ocean`), **Lavender** (`accent-lavender`), **Raspberry** (`accent-raspberry`). Each is one seed in `ACCENT_SEEDS`; its inks are derived by walking lightness until the text clears 4.5:1 (7:1 under increased contrast) on every surface it lands on. Coral, mint and amber sit next to a money colour and are still allowed (see the Named Rules).
- **Brand Coral** is the same coral as the palette's original `--primary`. It survives in static artifacts drawn from the stylesheet (emails, the app icon, the share image) and is the dot in the mark there. In the product the dot takes the reader's accent.

### Secondary: the money colours

Fixed literals, identical on every account and under every accent. Each comes as a **fill** (a bar, a tinted badge, a graphical object held to 3:1) and an **ink** (text at 4.5:1).

- **Settled-Up Green** (`settled-up-green`, ink `settled-up-green-ink`): somebody owes you; "gets back". Never used for anything else.
- **Owed Red** (`owed-red`, ink `owed-red-ink`): you owe. Destructive actions share the same hue family but use their own token, so a delete button is not a balance.
- **Paid-By Amber** (`paid-by-amber`, ink `paid-by-amber-ink`): who put the money in. The one role the accent cannot carry, because on the add screen the accent already means "in the split" and a payer is often also in it.
- **Settled Grey** (`settled-grey`, ink `settled-grey-ink`): zero. It carries no direction, washes with `linen-muted` rather than a colour of its own, and is always phrased in words.
- Dark-theme counterparts are `settled-up-green-dark`, `owed-red-dark`, `owed-red-ink-dark`, `paid-by-amber-dark` and `settled-grey-dark`. Most inks equal their fills in the dark theme, which already clears 4.5:1; the red ink is nudged up for the one case of a wash of its own fill.

### Neutral

- **Aubergine Ink** (`aubergine-ink`): the text colour on cream, the label on every accent fill, and the dark theme's ground itself. Plum, never black.
- **Cream Paper** (`cream-paper`): the page. There is no light-surface choice; the light palette is cream.
- **White Card** (`white-card`): a card or popover, one step up from the paper.
- **Plum Night Raised** (`plum-night-raised`): the dark card, dialog and sidebar surface.
- **Midnight** (`midnight`) and **Midnight Raised** (`midnight-raised`): the optional dark surface for OLED panels, applied with `data-dark="midnight"`; it restates only the tokens that differ.
- **Linen Muted** (`linen-muted`): a muted ground, an avatar fallback, a settled chip.
- **Lilac Secondary** (`lilac-secondary`, ink `lilac-secondary-ink`): the secondary button and badge, and the sidebar's active row.
- **Quiet Plum Text** (`quiet-plum-text`): secondary text and metadata, darkened further under increased contrast.
- **Hairline** (`hairline`) and **Field Line** (`field-line`): borders and form-field strokes. In the dark theme they are white at 12% and 16% (10% and 14% on Midnight), and both are strengthened to 38% and 42% when the system asks for more contrast.

### Named Rules

**The Fixed Money Colours Rule.** Green, red and amber are literals in `globals.css`. They are never derived from the accent, never rotated away from it, never recoloured per account. A search of the whole feasible red band found nothing better than a pink, which is why the rule is "fixed" rather than "tuned".

**The Word-and-Sign Rule.** Colour never carries a balance alone. Every figure has a sign (+ or −) and a word beside it ("gets back", "owes", "settled up") from `TONE` in `src/components/money/balance-tone.ts`. This is what lets an accent sit next to a money colour at all.

**The Accent Never Paints Money Rule.** `--primary` is the button, the ring, the link, the "you" pill and the "you" series. An amount, a balance bar or the chip above a figure takes its tone from `TONE`, never from `--primary`.

**The Ink-Is-Text Rule.** A token ending in `-ink` is text; the one without the suffix is a fill. Putting a fill on text is how a 2.6:1 figure gets back in.

**The One Pen Rule.** The accent is held back for the one action to take next. If a screen has three accent-filled things, two of them are wrong.

## Typography

**Interface Font:** Instrument Sans (with `ui-sans-serif, system-ui, sans-serif`), loaded through `next/font`. It carries the wordmark, headings, controls and amounts.
**Identifier Font:** Geist Mono, for identifiers and tokens only.
**Editorial Font:** Instrument Serif, at most one line per marketing surface and never inside the product.

**Character:** One grotesk does all the work, in a short scale and with figures that line up. Amounts are always lining and tabular (`font-feature-settings: "tnum", "lnum"` on `html`), so a column of money is a column.

### Hierarchy

Seven steps, and only these: `text-2xs` `text-xs` `text-sm` `text-base` `text-lg` `text-xl` `text-2xl`. Sizes below are the desk values; below `md` (48rem) every step is one point larger, by redefining `--text-*` tokens in `globals.css`.

- **Balance Hero** (600, 1.875rem, line-height 1, tracking −0.025em): the one figure a group's overview opens with. Set in a display size that is a deliberate one-off (also 2.125rem and 1.625rem on settle-up). Always a sign and a word nearby.
- **Headline** (600, 1.5rem / `text-2xl`, 1.2, tracking −0.02em): the page title; one per page, always an `h1`.
- **Title** (500, 1rem / `text-base`, `leading-snug`): a card title or a sheet title (`text-xl` semibold for sheets).
- **Body** (400, 0.875rem / `text-sm`, 1.25rem): the workhorse; the default and every control label. 0.9375rem on a phone.
- **Caption** (400, 0.75rem / `text-xs`, muted): row metadata, dates, names.
- **Label** (500, 0.75rem, +0.05em, uppercase, muted): a sub-group heading inside a card ("Should receive").
- **Micro** (500, 0.6875rem / `text-2xs`): avatar initials, the count on the bell, a category pill, a chart tick. The floor, for labels only.
- **Identifier** (Geist Mono, 0.875rem): ids, currency codes and tokens.

### Named Rules

**The Seven Steps Rule.** An arbitrary `text-[…]` inside the product is a bug. The balance heroes are the one exception. `type-scale.test.ts` fails the build on the rest.

**The Phone Point Rule.** Every step is a point larger below `md`, set once by redefining the tokens. Never move them into an `@theme inline` block; inline substitutes the value and the lever stops working.

**The 16px Field Rule.** A control that can take a caret or a picker (`input`, `textarea`, `select`) is never smaller than 16px on a phone, or iOS Safari zooms the page in and never zooms back out. Call sites say `text-base md:text-sm`; `globals.css` floors anything that states no size.

**The Floor Is For Labels Rule.** Nothing read as a sentence goes in `text-2xs`. A footnote or a caption starts at `text-xs`.

**The No Serif Inside Rule.** Instrument Serif is editorial. It does not appear in the signed-in product.

## Layout

Phone first, one readable column. The app is drawn for a 390pt screen and a desktop window gets the same screens with the room used modestly. The marketing homepage has its own editorial scale and is not covered by this system.

- **Below `md` (768px): the phone.** A sticky header (4rem, hairline beneath) and a bottom bar, one column, 1rem gutters, 1.5rem between sections, `max-w-3xl` content cap. Main content keeps `pb-28` plus the safe-area inset so the last row clears the bar and the home indicator.
- **`md` to `lg` (768 to 1023px): a tablet held upright.** The desk type scale, still the bar and the header. Bottom sheets stop at a phone's width from here.
- **`lg` up (1024px): the desk.** One sidebar (15rem, collapsible to 4rem) replaces the header and bar on every signed-in screen. A group's places become tabs under its name; the overview becomes two columns (money on the left, context on the right, in that document order so a screen reader reads the money first). Settings stays a surface of its own without the sidebar.
- **`xl` up (1280px):** 40px gutters and the group tile at 48px. From 1536px the wide column stops at 75rem and centres.
- **Rhythm:** 0.75rem inside rows and between sibling controls; 1rem card padding and mobile gutter (0.75rem at `size="sm"`); 1.25rem between fields in a form group; 1.5rem between page sections. Stack related rows inside one bordered, divided container rather than as separate cards.
- **Tap targets:** every control owes a finger 44px. Where there is room, it grows (`Button` default is 44px high on a phone, 32px from `md`); where there isn't, the box stays and `tap-target` grows an invisible 44px target underneath.

## Elevation & Depth

Flat by default. A surface is held by a 1px ring at 10% of the foreground (`ring-1 ring-foreground/10`), which works in both themes; in the dark theme a shadow would be invisible anyway. Importance comes from position (your own balance goes first), never from a shadow.

Shadows are reserved for what genuinely floats above the page. All are tinted with the plum ink hue, never neutral black.

### Shadow Vocabulary

- **Card** (`--shadow-card`: `0 1px 2px 0 oklch(0.226 0.072 319 / 0.05), 0 1px 3px 0 oklch(0.226 0.072 319 / 0.08)`): the lightest; the switch thumb and the active segment of a tab tray, the two small things that sit just proud of their own track.
- **Raised** (`--shadow-raised`: `0 4px 12px -2px oklch(0.226 0.072 319 / 0.1), 0 2px 6px -2px oklch(0.226 0.072 319 / 0.06)`): dialogs, popovers and dropdown menus.
- **Toast** (`--shadow-toast`: `0 16px 40px -12px oklch(0.226 0.072 319 / 0.3), 0 6px 14px -8px oklch(0.226 0.072 319 / 0.18)`): the only two-stage shadow in the app, because a toast is the one surface with nothing of ours behind it.
- **Hairline** (`--shadow-hairline`: `0 0 0 1px var(--border)`): a line drawn as a shadow where a border would cost a pixel of layout.
- **Swipe edge** (`box-shadow: -12px 0 28px -8px oklch(0 0 0 / 0.3)`): the leading edge of a screen being swiped back, so it reads as lifted off the one beneath.
- **Washes** (`--wash-1` to `--wash-4`: the foreground at 4%, 6%, 9% and 12%): a zebra row, a tile at rest, the same pressed, a tile that must hold against a card. A surface a shade off the one behind it, with no line and no shadow.

### Named Rules

**The Ring-Before-Shadow Rule.** A hairline ring is the default way a surface is held. A shadow means the thing floats.

**The No Nested Cards Rule.** Never nest a card in a card, and never give a card a shadow to imply importance.

**The Scrim Is Not A Surface Rule.** The page behind a two-step confirmation (signing out, deleting an account) is dimmed by `--scrim`, a darker plum at 72%, the same in both themes.

## Shapes

A single radius root, `--radius: 0.75rem`, and every other step is a multiplier, so re-rounding the product is a one-line change. Corners are soft and friendly without turning into pills, except where a pill is the point.

- **sm** (0.45rem, ×0.6): checkbox, inline code.
- **md** (0.6rem, ×0.8): small buttons and skeletons.
- **lg** (0.75rem, ×1): buttons, inputs, list containers.
- **xl** (1.05rem, ×1.4): cards, dialogs, empty states.
- **4xl** (1.95rem, ×2.6): badges, so they read as pills.
- **full:** avatars and the sidebar tile marks.

Borders are 1px hairlines. The mark is three parts at one width: a **dot** for what was spent, a **rule** that divides it, a **pan** underneath that catches everyone's share. Nothing decorative. The rule and pan take the text colour; the dot is the accent.

## Components

Soft, tactile and certain. A control is rounded, answers a press at once, and is never ambiguous about what can be tapped.

### Buttons

- **Shape:** gently rounded (0.75rem), 1px transparent border so focus can swap it for the ring.
- **Primary (`default`):** Plum Accent fill with Aubergine Ink label, `text-sm` medium, 44px high on a phone and 32px from `md` (48 and 36 at `lg`). Hover mixes the fill to 80%. The label is the ink on the fill, so it never needs the `-ink` token.
- **Secondary:** Lilac Secondary with its ink; **Outline:** Cream Paper (or the field fill in dark) with a hairline and a muted wash on hover; **Ghost:** no ground until hover; **Destructive:** a tinted wash of the destructive colour at 10% with red text, never a solid red fill; **Link:** `primary-ink` text, underline on hover.
- **Press and focus:** a 1px downward translate on `:active` (mechanical, not animated; menu triggers with `aria-haspopup` are excluded); focus turns the border to `--ring` and adds a 3px ring at 50%. Disabled is 50% opacity with pointer events off.
- **Small and icon sizes** keep a compact box (24 to 36px) and take their 44px from `tap-target`.

### Chips and Badges

- **Style:** a 20px-high pill (`rounded-4xl`), `text-xs` medium, `px-2`. Variants: default (accent fill), secondary, destructive (10% wash), outline (hairline), ghost, link.
- **Balance chips:** a tinted wash of the tone (`bg-positive/15`, `bg-negative/15`, or `bg-muted` for settled) with the tone's ink on top, and a sign and word. Never the accent.

### Cards / Containers

- **Corner Style:** 1.05rem (`rounded-xl`), overflow hidden.
- **Background:** White Card on cream; Plum Night Raised in the dark theme.
- **Shadow Strategy:** none; held by the 10% foreground ring.
- **Border:** the ring is the border.
- **Internal Padding:** 1rem (0.75rem at `size="sm"`); a footer sits flush to the bottom edge.
- Stacked content prefers a `divide-y` list inside one bordered rounded container to a stack of cards.

### Inputs / Fields

- **Style:** 0.75rem radius, 1px `--input` stroke, transparent ground (a 30% field wash in dark), `text-base` on a phone and `md:text-sm` from the desk.
- **Focus:** the border becomes `--ring` plus a 3px ring at 50%.
- **Error / Disabled:** `aria-invalid` swaps the border and ring to destructive; disabled is 50% opacity on a muted ground.

### Navigation

- **Phone:** a sticky 4rem header carrying the wordmark and an avatar link to the account, with a hairline beneath, and a bottom bar of a group's destinations (74px a tab, safe-area aware). There is no hamburger.
- **Desk (`lg` up):** one sidebar with brand, search ("Search or jump to"), the Add action, Home, Notifications, and groups as tiles with a live position line ("you are owed €248.00", "you owe CHF 62.20"), then the account. A group's header carries its tile, name, meta and a row of tabs (Overview, Transactions, People, Settings), drawn as a segmented tray on `linen-muted` whose active segment lifts to a White Card with a hairline and the lightest shadow.
- **Chrome does not travel:** the header, bar, sidebar and toaster are held still during a page transition.

### Dialogs, Sheets and Toasts

- **Phone:** a bottom sheet with a rounded top, rising over a screen that holds still. **Desk:** the same content as a centred dialog (the entry form opens as one, with the split on the form and ⌘↵ to save).
- Dialogs, popovers and menus carry `--shadow-raised`. Toasts carry `--shadow-toast`, use the app's own unstyled sonner skin, and are reserved for refusals, something that has left the screen, and changes that took more than a tap. A switch or chip that saves on press says nothing.

### Balance Position (signature)

The figure a group opens with: a small muted heading, the Balance Hero numeral with its sign, a tone-coloured word and a one-line explanation, then the actions. A copy of the figure is held under the header as a **position strip** once the card has scrolled away, driven purely by CSS scroll timelines (`animation-timeline: scroll(root block)`), and absent where that feature is unsupported.

### The Wordmark (signature)

The mark is an inline SVG (dot, rule, pan). Hovering the header mark plays a one-second split in which shares drop from the dot into the pan, moving only transform and opacity. Reduced motion shows nothing.

### Charts

Five tokens: `chart-1` aubergine-family, `chart-2` the accent (always the "you" series), `chart-3` teal, `chart-4` blue-grey, `chart-5` pale plum. The categorical colours are kept a visible distance from every accent and every money colour so a bar is never mistaken for a balance.

## Do's and Don'ts

### Do:

- **Do** put a sign and a word beside every balance figure, using `TONE`.
- **Do** set money in lining, tabular figures so a column lines up.
- **Do** read tone from `TONE` for an amount, a bar or the chip above a figure, and from `--primary` for the button, ring, link and "you".
- **Do** use `-ink` tokens for text and the plain token for fills.
- **Do** give every control a 44px target on a phone, growing the target underneath when the box cannot grow.
- **Do** make a text-entry control `text-base md:text-sm` so iOS never zooms.
- **Do** separate surfaces with the 1px ring and put the most important thing first on the page.
- **Do** keep one vocabulary of motion: a page travels, a section fades, a drawer rises. Animate colour, opacity and transform only.
- **Do** let a switch, chip or swatch save in silence, and speak only for a refusal, something removed, or a change that took more than a tap.

### Don't:

- **Don't** derive, rotate or recolour green, red or amber from the accent, and don't use green for anything but "somebody owes you".
- **Don't** let colour carry a balance alone.
- **Don't** make it look like banking software, a gamified money app, generic SaaS gloss, or Splitwise's brand green.
- **Don't** put a fill token on text; it is 2.6:1 on cream.
- **Don't** nest a card in a card, or use a shadow to imply importance.
- **Don't** write an arbitrary `text-[…]` size in the product, or use `text-2xs` for anything read as a sentence.
- **Don't** animate the height, width or position of anything holding an amount; a number that slides while you read it is worse than none.
- **Don't** use Instrument Serif inside the signed-in product.
- **Don't** show a toast to confirm something the control already moved to show.
- **Don't** put the marketing homepage's editorial scale into the product, or product rules into the marketing homepage.
