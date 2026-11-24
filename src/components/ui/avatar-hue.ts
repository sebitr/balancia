/**
 * A stable hue for a person's face.
 *
 * Every fallback avatar used to be the same lilac, so the only thing telling
 * three people apart was their initial. Each person now gets one of a small
 * set of muted hues, chosen from a key that never changes — their participant
 * id where a screen has it, their name only where it does not — so the same
 * person is the same colour on the home screen, in a split sheet and on the
 * People page.
 *
 * What the palette leaves out is the point of it. Green, red and amber are
 * the only colours in the app that carry meaning (AGENTS.md, "The money
 * colours never move"), so no hue here comes within `MONEY_CLEARANCE` degrees
 * of them; and the chroma is low enough that a face is a tint, not a fill —
 * nothing here can be mistaken for a balance bar or the "who paid" amber.
 * `avatar-hue.test.ts` reads the money hues out of `globals.css` and fails on
 * a palette that drifts into them.
 *
 * The colours themselves are in `globals.css` (`[data-avatar-hue]`), as a
 * lightness and chroma per theme with this hue slotted in. The test holds
 * the initial to 4.5:1 on its tint, light and dark.
 */

/** Degrees of OKLCH hue. Blue-greens, blues, violets and one rose. */
export const AVATAR_HUES = [200, 225, 250, 275, 345] as const;

/** How far, in degrees, a palette hue must stay from every money hue. */
export const MONEY_CLEARANCE = 25;

/** FNV-1a: small, dependency-free, and the same in every JavaScript engine. */
function hash(key: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < key.length; index += 1) {
    value ^= key.charCodeAt(index);
    value = Math.imul(value, 0x01000193) >>> 0;
  }
  return value;
}

/** The hue for a key. The same key is always the same hue. */
export function avatarHue(key: string): number {
  return AVATAR_HUES[hash(key.trim().toLowerCase()) % AVATAR_HUES.length]!;
}
