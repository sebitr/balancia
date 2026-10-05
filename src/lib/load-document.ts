/**
 * Goes to `href` as a document load rather than through the router.
 *
 * For the one kind of navigation the router gets wrong: between two addresses
 * that share a layout whose output depends on the address. A soft navigation
 * keeps the layout it has, and the root layout is where `<html lang>` and the
 * browser's messages were written.
 *
 * A function of its own because jsdom's `location` can be neither replaced
 * nor spied on, so a test can only watch this.
 */
export function loadDocument(href: string): void {
  window.location.assign(href);
}
