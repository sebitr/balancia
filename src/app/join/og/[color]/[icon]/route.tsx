import { createElement } from "react";
import { ImageResponse } from "next/og";
import { blend } from "@/lib/color/oklch";
import { palette } from "@/modules/auth/emails/tokens";
import { themeColorFor } from "@/modules/profile/surface";
import { isGroupIconColor } from "@/modules/groups/icons";
import {
  GLYPH_VIEWBOX,
  SHARE_CARD_GLYPHS,
  type GlyphShape,
} from "@/modules/groups/share-card-glyphs";
import {
  isShareCardIcon,
  NO_SHARE_CARD_ICON,
  shareCardAccent,
  SHARE_CARD_SIZE,
} from "@/modules/groups/share-card";

/**
 * The picture in the chat bubble a join link is pasted into.
 *
 * The group wears an icon in an accent, and this is that decoration at poster
 * size, on the brand's ground, over the wordmark. Which is all the URL says:
 * `/join/og/coral/plane` names a *style*, not a group. The name of the group
 * travels in `og:title`, in the document `/join/g/[token]` serves to the same
 * crawler — so this image can be public, guessable and cached for a year
 * without being a way to learn anything.
 *
 * Seventy-five of them exist, five accents by fifteen icons, plus the five a
 * group with no icon gets. Anything else is a 404 rather than a default: a
 * card is only ever linked from a document this codebase wrote.
 *
 * Colours are hex because satori resolves neither `oklch()` nor a custom
 * property — see `share-card.ts` for where they come from and what keeps them
 * honest. The ground is borrowed from the email palette for the same reason
 * `src/app/opengraph-image.tsx` borrows it: it is the one place the theme is
 * already written down as literals.
 */

const GROUND = palette.ink;
const CREAM = themeColorFor("cream");

/** A year, immutable: the drawing depends on the path and nothing else. */
const CACHE = "public, max-age=31536000, immutable";

/**
 * A group's icon, drawn from its shapes rather than from its component.
 *
 * The stroke is named rather than inherited: satori draws the SVG itself and
 * carries no `currentColor`. Its weight is the tile's, and it is in viewBox
 * units, so the glyph scales up at exactly the weight it has on screen.
 */
function Glyph({
  shapes,
  size,
  accent,
}: {
  shapes: readonly GlyphShape[];
  size: number;
  accent: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox={GLYPH_VIEWBOX}
      fill="none"
      stroke={accent}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {shapes.map(([tag, attributes], index) =>
        createElement(tag, { key: index, ...attributes }),
      )}
    </svg>
  );
}

/**
 * The wordmark: the three bars of the mark, then the name.
 *
 * Every measurement is a fraction of `unit`, the mark's width, so the same
 * lockup sits under a group's icon at reading size or stands alone at poster
 * size. The dot takes the group's accent, which is the one liberty this card
 * takes with the mark, and the only colour a wordless card carries.
 */
function Wordmark({
  unit,
  fontSize,
  accent,
}: {
  unit: number;
  fontSize: number;
  accent: string;
}) {
  const bar = (width: number) => (
    <div
      style={{
        background: CREAM,
        borderRadius: "999px",
        display: "flex",
        height: `${unit * 0.18}px`,
        width: `${width}px`,
      }}
    />
  );
  return (
    <div
      style={{
        alignItems: "center",
        display: "flex",
        fontSize,
        fontWeight: 700,
        gap: `${unit * 0.42}px`,
        letterSpacing: `${fontSize * -0.022}px`,
      }}
    >
      <div
        style={{
          alignItems: "center",
          display: "flex",
          flexDirection: "column",
          gap: `${unit * 0.18}px`,
          width: `${unit}px`,
        }}
      >
        <div
          style={{
            background: accent,
            borderRadius: "999px",
            display: "flex",
            height: `${unit * 0.21}px`,
            width: `${unit * 0.21}px`,
          }}
        />
        {bar(unit * 0.9)}
        {bar(unit * 0.47)}
      </div>
      Balancia
    </div>
  );
}

export async function GET(
  _request: Request,
  context: RouteContext<"/join/og/[color]/[icon]">,
) {
  const { color, icon } = await context.params;
  if (!isGroupIconColor(color) || !isShareCardIcon(icon)) {
    return new Response("Not found", { status: 404 });
  }

  const accent = shareCardAccent(color);
  const shapes = icon === NO_SHARE_CARD_ICON ? null : SHARE_CARD_GLYPHS[icon];

  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: GROUND,
        color: CREAM,
        display: "flex",
        flexDirection: "column",
        gap: "56px",
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      {/*
       * A group that chose no icon gets the wordmark alone, at poster size.
       * Standing the mark inside the tile as well would put the same three
       * bars on one card twice, at two sizes, which reads as a mistake.
       */}
      {shapes ? (
        <div
          style={{
            alignItems: "center",
            background: blend(accent, 0.2, GROUND),
            borderRadius: "88px",
            display: "flex",
            height: "336px",
            justifyContent: "center",
            width: "336px",
          }}
        >
          <Glyph shapes={shapes} size={184} accent={accent} />
        </div>
      ) : null}
      <Wordmark
        unit={shapes ? 48 : 116}
        fontSize={shapes ? 46 : 112}
        accent={accent}
      />
    </div>,
    { ...SHARE_CARD_SIZE, headers: { "Cache-Control": CACHE } },
  );
}
