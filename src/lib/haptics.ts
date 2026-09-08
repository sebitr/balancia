/**
 * A short buzz for the two moments a finger commits to something.
 *
 * ## What this is and is not
 *
 * It is the Vibration API, which is Chrome and Android. Safari implements
 * none of it, on the phone or the desk, so on an iPhone every call here is a
 * no-op — and that is worth stating plainly rather than discovering later,
 * because it means nothing in the app may ever *depend* on the buzz. It is
 * confirmation laid on top of a confirmation that is already on the screen,
 * never the confirmation itself. Take the vibration away, as iOS does, and
 * the interface still says everything it needs to.
 *
 * It is deliberately not a taptic engine. `vibrate` drives one motor with one
 * duration; the crisp, pitched taps a native iOS app makes come from an API
 * the web does not have. Trying to imitate those with a pattern of pulses
 * produces a rattle, so there are two lengths here and no more.
 *
 * ## Why the calls are unguarded
 *
 * `vibrate` throws nothing and returns `false` when it is refused — outside a
 * user gesture, in a background tab, or on a device with no motor. Every call
 * site here is inside the gesture that caused it, which is the only condition
 * the spec actually requires, so a `false` means the platform declined and
 * there is nothing to do about it.
 */

/** The two things worth feeling, and how long each one lasts in ms. */
const PATTERNS = {
  /** A row committed to leaving — the moment the finger lets go past the line. */
  commit: 12,
  /** Something recorded that changes the money. Longer, and only just. */
  confirm: 24,
} as const;

export type Haptic = keyof typeof PATTERNS;

export function haptic(kind: Haptic): void {
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  navigator.vibrate(PATTERNS[kind]);
}
