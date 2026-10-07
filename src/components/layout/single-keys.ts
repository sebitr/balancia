/**
 * Whether N and S do anything on this device: the "Single-key shortcuts"
 * switch under Settings › Appearance & language.
 *
 * WCAG 2.1.4 asks that a shortcut made of one character can be turned off. A
 * reader who drives the page by voice, or who types with a switch device, can
 * fire a letter without meaning to, and a stray N opening a dialog over the
 * screen is exactly the surprise the criterion is about. ⌘K and ⌘\ need a
 * modifier, so they are not covered and stay on.
 *
 * Kept per device, like the dark surface and the folded sidebar: the laptop
 * with a keyboard is not the tablet that syncs with it. A cookie rather than
 * local storage, so the settings screen draws the switch the way it stands on
 * the first paint instead of flicking it across a frame later. The browser
 * writes it — the switch is a control that flicks back, and nothing about it
 * can fail on a server.
 *
 * On is the absence of a choice, so turning the keys back on clears the cookie
 * rather than recording a second value.
 */
export const SINGLE_KEYS_COOKIE_NAME = "balancia_single_keys";

export const SINGLE_KEYS_OFF = "off";

/** A year, like every other display preference kept per device. */
const MAX_AGE = 60 * 60 * 24 * 365;

/** Anything but the one value is the default — the cookie is not HttpOnly. */
export function areSingleKeysOn(value: string | undefined): boolean {
  return value !== SINGLE_KEYS_OFF;
}

/** The device's choice as the browser holds it now. */
export function readSingleKeys(): boolean {
  const entry = document.cookie
    .split("; ")
    .find((part) => part.startsWith(`${SINGLE_KEYS_COOKIE_NAME}=`));
  return areSingleKeysOn(entry?.slice(SINGLE_KEYS_COOKIE_NAME.length + 1));
}

/** Written by the browser, the moment the switch moves. */
export function rememberSingleKeys(on: boolean): void {
  const secure = window.location.protocol === "https:" ? "; secure" : "";
  document.cookie = on
    ? `${SINGLE_KEYS_COOKIE_NAME}=; path=/; max-age=0; samesite=lax${secure}`
    : `${SINGLE_KEYS_COOKIE_NAME}=${SINGLE_KEYS_OFF}; path=/; max-age=${MAX_AGE}; samesite=lax${secure}`;
}
