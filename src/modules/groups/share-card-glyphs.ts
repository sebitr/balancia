import type { GroupIcon } from "./icons";

/**
 * The fifteen group icons as plain SVG, for the share card.
 *
 * Everywhere else in the app the icon is `<Plane />` from `lucide-react`, and
 * that is what `GROUP_ICON_GLYPHS` hands out. It cannot be used here: satori,
 * which draws the card, has its own miniature renderer that calls a function
 * component directly, with no React runtime behind it — and every lucide icon
 * since v1 reads a context, so the first one hit throws "Invalid hook call"
 * and the card is a 500 rather than a wrong drawing.
 *
 * So the geometry is copied, and `share-card-glyphs.test.tsx` is what stops
 * the copy drifting: it renders each lucide component and compares it, shape
 * by shape and attribute by attribute, against the entry below. Upgrade
 * lucide and redraw an icon, and the test names the one that no longer
 * matches — which is the same arrangement, and the same reason, as the email
 * palette in `src/modules/auth/emails/tokens.ts`.
 *
 * Only the shapes are here. The stroke, its weight and the joins belong to
 * whoever is drawing, and the card sets them to match the tile.
 */

export type GlyphShape = readonly [
  tag: "path" | "circle" | "rect",
  attributes: Readonly<Record<string, string>>,
];

export const SHARE_CARD_GLYPHS: Record<GroupIcon, readonly GlyphShape[]> = {
  plane: [
    [
      "path",
      {
        d: "M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z",
      },
    ],
  ],
  luggage: [
    [
      "path",
      {
        d: "M6 20a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2",
      },
    ],
    ["path", { d: "M8 18V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v14" }],
    ["path", { d: "M10 20h4" }],
    ["circle", { cx: "16", cy: "20", r: "2" }],
    ["circle", { cx: "8", cy: "20", r: "2" }],
  ],
  house: [
    ["path", { d: "M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8" }],
    [
      "path",
      {
        d: "M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
      },
    ],
  ],
  tent: [
    ["path", { d: "M3.5 21 14 3" }],
    ["path", { d: "M20.5 21 10 3" }],
    ["path", { d: "M15.5 21 12 15l-3.5 6" }],
    ["path", { d: "M2 21h20" }],
  ],
  car: [
    [
      "path",
      {
        d: "M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2",
      },
    ],
    ["circle", { cx: "7", cy: "17", r: "2" }],
    ["path", { d: "M9 17h6" }],
    ["circle", { cx: "17", cy: "17", r: "2" }],
  ],
  cart: [
    [
      "path",
      {
        d: "m2.05 2.05 1.099-.028a1 1 0 0 1 1.008.815l2.69 14.347A1 1 0 0 0 7.83 18H18",
      },
    ],
    [
      "path",
      {
        d: "M4.563 5h16.435a1 1 0 0 1 .981 1.204l-1.026 6.226A2 2 0 0 1 18.962 14H6.25",
      },
    ],
    ["circle", { cx: "18", cy: "20", r: "2" }],
    ["circle", { cx: "8", cy: "20", r: "2" }],
  ],
  coffee: [
    ["path", { d: "M10 2v2" }],
    ["path", { d: "M14 2v2" }],
    [
      "path",
      {
        d: "M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1",
      },
    ],
    ["path", { d: "M6 2v2" }],
  ],
  meal: [
    ["path", { d: "M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2" }],
    ["path", { d: "M7 2v20" }],
    ["path", { d: "M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7" }],
  ],
  party: [
    ["path", { d: "M5.8 11.3 2 22l10.7-3.79" }],
    ["path", { d: "M4 3h.01" }],
    ["path", { d: "M22 8h.01" }],
    ["path", { d: "M15 2h.01" }],
    ["path", { d: "M22 20h.01" }],
    [
      "path",
      {
        d: "m22 2-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10",
      },
    ],
    [
      "path",
      {
        d: "m22 13-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17",
      },
    ],
    [
      "path",
      {
        d: "m11 2 .33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7",
      },
    ],
    [
      "path",
      {
        d: "M11 13c1.93 1.93 2.83 4.17 2 5-.83.83-3.07-.07-5-2-1.93-1.93-2.83-4.17-2-5 .83-.83 3.07.07 5 2Z",
      },
    ],
  ],
  gift: [
    ["path", { d: "M12 7v14" }],
    ["path", { d: "M20 11v8a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-8" }],
    [
      "path",
      {
        d: "M7.5 7a1 1 0 0 1 0-5A4.8 8 0 0 1 12 7a4.8 8 0 0 1 4.5-5 1 1 0 0 1 0 5",
      },
    ],
    ["rect", { x: "3", y: "7", width: "18", height: "4", rx: "1" }],
  ],
  music: [
    ["path", { d: "M9 18V5l12-2v13" }],
    ["circle", { cx: "6", cy: "18", r: "3" }],
    ["circle", { cx: "18", cy: "16", r: "3" }],
  ],
  sport: [
    ["path", { d: "M11 7a16 16 20 0 1 10.98 4.362" }],
    ["path", { d: "M12 12a13 13 0 0 1-8.66 5" }],
    ["path", { d: "M16.83 13.634a16 16 0 0 1-9.267 7.328" }],
    ["path", { d: "M20.66 17A13 13 0 0 0 12 12a13 13 0 0 1 0-10" }],
    ["path", { d: "M8.17 15.366a16 16 0 0 1-1.713-11.69" }],
    ["circle", { cx: "12", cy: "12", r: "10" }],
  ],
  bike: [
    ["circle", { cx: "18.5", cy: "17.5", r: "3.5" }],
    ["circle", { cx: "5.5", cy: "17.5", r: "3.5" }],
    ["circle", { cx: "15", cy: "5", r: "1" }],
    ["path", { d: "M12 17.5V14l-3-3 4-3 2 3h2" }],
  ],
  heart: [
    [
      "path",
      {
        d: "M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5",
      },
    ],
  ],
  star: [
    [
      "path",
      {
        d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z",
      },
    ],
  ],
};

/** The viewBox every lucide icon is drawn in. */
export const GLYPH_VIEWBOX = "0 0 24 24";
