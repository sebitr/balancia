import { ImageResponse } from "next/og";
import { palette } from "@/modules/auth/emails/tokens";
import { themeColorFor } from "@/modules/profile/surface";

/**
 * The share card cannot use a CSS variable — satori resolves none — so its
 * colours are hexes. They are taken from the tokens rather than typed out:
 * the two that had been typed out had already drifted, the cream by four
 * units and the coral by three.
 *
 * The two tints below have no token of their own; they are this card's, and
 * they are only ever seen beside the three above.
 */
const GROUND = palette.ink;
const CREAM = themeColorFor("cream");
const CORAL = palette.primary;

export const alt =
  "Balancia — shared expenses, fairly balanced on a server you control";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        alignItems: "center",
        background: GROUND,
        color: CREAM,
        display: "flex",
        height: "100%",
        justifyContent: "center",
        padding: "72px",
        width: "100%",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "36px",
          maxWidth: "1056px",
          width: "100%",
        }}
      >
        <div
          style={{
            alignItems: "center",
            display: "flex",
            fontSize: 34,
            fontWeight: 700,
            gap: "16px",
          }}
        >
          <div
            style={{
              alignItems: "center",
              display: "flex",
              flexDirection: "column",
              gap: "7px",
              width: "38px",
            }}
          >
            <div
              style={{
                background: CORAL,
                borderRadius: "999px",
                display: "flex",
                height: "8px",
                width: "8px",
              }}
            />
            <div
              style={{
                background: CREAM,
                borderRadius: "999px",
                display: "flex",
                height: "7px",
                width: "34px",
              }}
            />
            <div
              style={{
                background: CREAM,
                borderRadius: "999px",
                display: "flex",
                height: "7px",
                width: "18px",
              }}
            />
          </div>
          Balancia
        </div>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            fontSize: 78,
            fontWeight: 700,
            letterSpacing: "-3px",
            lineHeight: 1.04,
          }}
        >
          <div style={{ display: "flex" }}>Shared expenses,</div>
          <div style={{ color: CORAL, display: "flex" }}>fairly balanced.</div>
        </div>

        <div
          style={{
            color: "#e9dfe9",
            display: "flex",
            fontSize: 31,
            lineHeight: 1.35,
            maxWidth: "900px",
          }}
        >
          Free, open-source expense splitting for trips, households and groups —
          hosted or self-hosted.
        </div>

        <div
          style={{
            color: "#ffb1a6",
            display: "flex",
            fontSize: 24,
            fontWeight: 600,
            gap: "18px",
          }}
        >
          <span>Exact splits</span>
          <span>·</span>
          <span>Multi-currency</span>
          <span>·</span>
          <span>Your data</span>
        </div>
      </div>
    </div>,
    size,
  );
}
