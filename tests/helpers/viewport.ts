import { act } from "@testing-library/react";

/**
 * A stand-in for `window.visualViewport`, which jsdom does not implement.
 *
 * The one thing about the on-screen keyboard that cannot be seen in a desktop
 * browser is the keyboard: `visualViewport` never shrinks there, so the branch
 * that matters never runs. Faking it is also the only way to assert the
 * arithmetic — a phone can show you the bug but cannot tell you the sheet
 * moved by exactly the right number of pixels.
 */

/** The layout viewport, which a keyboard does not shorten. */
export const LAYOUT_HEIGHT = 800;

export function fakeViewport(height = LAYOUT_HEIGHT, offsetTop = 0) {
  const listeners = new Set<() => void>();
  const viewport = {
    height,
    offsetTop,
    addEventListener: (_: string, listener: () => void) =>
      void listeners.add(listener),
    removeEventListener: (_: string, listener: () => void) =>
      void listeners.delete(listener),
    /** Opens a keyboard `covered` pixels tall, or puts it away at zero. */
    keyboard(covered: number) {
      viewport.height = LAYOUT_HEIGHT - covered;
      act(() => listeners.forEach((listener) => listener()));
    },
  };
  Object.defineProperty(window, "visualViewport", {
    value: viewport,
    configurable: true,
    writable: true,
  });
  window.innerHeight = LAYOUT_HEIGHT;
  return viewport;
}

/** Puts the real (missing) viewport back; call from `afterEach`. */
export function releaseViewport() {
  Reflect.deleteProperty(window, "visualViewport");
}
